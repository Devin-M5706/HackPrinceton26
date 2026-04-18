-- NomaAlert — phone auth additions
-- Adds phone number to CHWs for Firebase phone auth lookup

alter table chws add column if not exists phone text unique;
