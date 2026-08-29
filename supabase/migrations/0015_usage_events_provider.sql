-- Records which provider actually served a usage_events row, and the model
-- id that was requested (a rolling alias, e.g. "gemini-flash-latest") vs.
-- `model`, which already holds the resolved model the provider echoed back.
-- Both nullable: existing rows (and any direct test insert that doesn't set
-- them) predate this and have no way to know their provider retroactively.
alter table public.usage_events add column provider text;
alter table public.usage_events add column requested_model text;
