-- Nov 9: the board lists machines in their physical order in the garage, left to right:
-- Fathom, Centaur, Whirlwind, White Water, Cactus Canyon, D&D. Safe to run more than once.
update public.machines set sort_order = 1 where id = 2; -- Fathom
update public.machines set sort_order = 2 where id = 1; -- Centaur
