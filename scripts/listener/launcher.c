// Garage Lights Listener: the app macOS gives the "record system audio" permission to. It runs
// node scripts/music-sync.mjs as its child (so the permission covers the listener and scripts/systap),
// passes Ctrl-C / logout on to it, and exits when it does (launchd then starts it again).
// Built by scripts/listener/install.sh, which fills in NODE and SCRIPT.
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
static pid_t child = 0;
static void pass_on(int sig) { if (child > 0) kill(child, sig); }
int main(void) {
  char *argv[] = { NODE, SCRIPT, NULL };
  signal(SIGTERM, pass_on); signal(SIGINT, pass_on); signal(SIGHUP, pass_on);
  if (posix_spawn(&child, NODE, NULL, NULL, argv, environ) != 0) { perror("garage lights listener: can't start node"); return 1; }
  int st = 0;
  while (waitpid(child, &st, 0) < 0) { /* interrupted by a signal: keep waiting */ }
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
