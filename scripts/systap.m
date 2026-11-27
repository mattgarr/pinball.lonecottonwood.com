// systap: write what this Mac is playing (all apps, mixed) to stdout as 16-bit mono PCM.
// Uses a Core Audio process tap (macOS 14.2+): nothing about the sound output changes; the music keeps
// going to the speakers (AirPlay or not). The first line on stderr is "RATE <hz>" (the output rate).
// macOS asks once for permission to record system audio (System Settings → Privacy & Security →
// Screen & System Audio Recording) for the app that runs it (e.g. Terminal).
// Build: clang -fobjc-arc -framework CoreAudio -framework Foundation -o scripts/systap scripts/systap.m
#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/AudioHardwareTapping.h>
#include <stdio.h>
#include <unistd.h>

static void die(const char *what, OSStatus e) { fprintf(stderr, "systap: %s failed (%d)\n", what, (int)e); exit(1); }

int main(void) {
  @autoreleasepool {
    // A private tap on every process's output, unmuted (you still hear everything).
    CATapDescription *desc = [[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:@[]];
    desc.name = @"Garage lights music tap";
    desc.privateTap = YES;
    desc.muteBehavior = CATapUnmuted;
    AudioObjectID tap = kAudioObjectUnknown;
    OSStatus e = AudioHardwareCreateProcessTap(desc, &tap);
    if (e) die("create tap", e);

    // A private aggregate device with only the tap in it: it reads the tap, and plays nothing.
    NSString *uid = [NSString stringWithFormat:@"com.lonecottonwood.systap.%d", getpid()];
    NSDictionary *agg = @{
      @kAudioAggregateDeviceNameKey: @"Garage lights music tap",
      @kAudioAggregateDeviceUIDKey: uid,
      @kAudioAggregateDeviceIsPrivateKey: @YES,
      @kAudioAggregateDeviceIsStackedKey: @NO,
      @kAudioAggregateDeviceTapAutoStartKey: @YES,
      @kAudioAggregateDeviceTapListKey: @[@{ @kAudioSubTapUIDKey: desc.UUID.UUIDString, @kAudioSubTapDriftCompensationKey: @YES }],
    };
    AudioObjectID dev = kAudioObjectUnknown;
    e = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)agg, &dev);
    if (e) die("create aggregate", e);

    AudioStreamBasicDescription fmt = {0};
    UInt32 sz = sizeof(fmt);
    AudioObjectPropertyAddress fa = { kAudioTapPropertyFormat, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    e = AudioObjectGetPropertyData(tap, &fa, 0, NULL, &sz, &fmt);
    if (e) die("read tap format", e);
    // Halve the rate (44.1/48 kHz → 22.05/24 kHz): plenty for beats and a 16-band EQ.
    const int step = fmt.mSampleRate >= 44100 ? 2 : 1;
    fprintf(stderr, "RATE %d\n", (int)(fmt.mSampleRate / step));
    fflush(stderr);
    const BOOL isFloat = (fmt.mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    __block int phase = 0;

    AudioDeviceIOProcID proc = NULL;
    e = AudioDeviceCreateIOProcIDWithBlock(&proc, dev, NULL,
      ^(const AudioTimeStamp *now, const AudioBufferList *in, const AudioTimeStamp *inTime, AudioBufferList *out, const AudioTimeStamp *outTime) {
        static int16_t buf[8192];
        int n = 0;
        for (UInt32 b = 0; b < in->mNumberBuffers; b++) {
          const AudioBuffer ab = in->mBuffers[b];
          const UInt32 ch = ab.mNumberChannels ? ab.mNumberChannels : 1;
          if (!isFloat || !ab.mData) continue;
          const float *f = (const float *)ab.mData;
          const UInt32 frames = ab.mDataByteSize / (sizeof(float) * ch);
          for (UInt32 i = 0; i < frames; i++) {
            if (phase++ % step) continue;
            float v = 0;
            for (UInt32 c = 0; c < ch; c++) v += f[i * ch + c];
            v /= ch;
            if (v > 1) v = 1; if (v < -1) v = -1;
            buf[n++] = (int16_t)(v * 32767);
            if (n == 8192) { fwrite(buf, 2, n, stdout); n = 0; }
          }
          break; // first buffer (the tap) only
        }
        if (n) fwrite(buf, 2, n, stdout);
        fflush(stdout);
      });
    if (e) die("create io proc", e);
    e = AudioDeviceStart(dev, proc);
    if (e) die("start", e);

    // Clean up on Ctrl-C / when the reader goes away.
    signal(SIGPIPE, SIG_IGN);
    dispatch_source_t s1 = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGINT, 0, dispatch_get_main_queue());
    dispatch_source_t s2 = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    void (^stop)(void) = ^{ AudioDeviceStop(dev, proc); AudioDeviceDestroyIOProcID(dev, proc); AudioHardwareDestroyAggregateDevice(dev); AudioHardwareDestroyProcessTap(tap); exit(0); };
    signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN);
    dispatch_source_set_event_handler(s1, stop); dispatch_source_set_event_handler(s2, stop);
    dispatch_resume(s1); dispatch_resume(s2);
    // Exit if stdout closes (the listener stopped).
    dispatch_source_t t = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(t, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
    dispatch_source_set_event_handler(t, ^{ if (ferror(stdout) || write(STDOUT_FILENO, "", 0) < 0) stop(); });
    dispatch_resume(t);
    dispatch_main();
  }
}
