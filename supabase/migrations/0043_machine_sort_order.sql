-- Machines in the garage's left-to-right order (same as the light strip):
-- Fathom, Centaur, Cactus Canyon, Whirlwind, White Water, Dungeons & Dragons.
update public.machines set sort_order = 3 where id = 5;
update public.machines set sort_order = 4 where id = 3;
update public.machines set sort_order = 5 where id = 4;
