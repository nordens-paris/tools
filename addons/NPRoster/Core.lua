-- NP Roster: roster import, invites, group sorting and attendance tracking.
local ADDON, ns = ...
local NPR = {}
ns.NPR = NPR

local InviteUnitFn = (C_PartyInfo and C_PartyInfo.InviteUnit) or InviteUnit
local ConvertToRaidFn = (C_PartyInfo and C_PartyInfo.ConvertToRaid) or ConvertToRaid
local GuildRosterFn = (C_GuildInfo and C_GuildInfo.GuildRoster) or GuildRoster

local SORT_MAX_STEPS = 60
local LATE_SECONDS = 15 * 60

-- ---------- helpers ----------
local function trim(s)
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function splitList(s)
  local t = {}
  for part in string.gmatch(s or "", "([^,]+)") do
    part = trim(part)
    if part ~= "" then t[#t + 1] = part end
  end
  return t
end

local function splitFields(line)
  local t = {}
  for part in string.gmatch(line .. ";", "([^;]*);") do t[#t + 1] = part end
  return t
end

-- WoW Forever names are "Firstname-Lastname", so only a trailing "-<our realm>" is removed,
-- never everything after the first hyphen.
local function shortName(name)
  if not name then return nil end
  local realm = GetNormalizedRealmName and GetNormalizedRealmName()
  if realm and realm ~= "" then
    local suffix = "-" .. realm
    if #name > #suffix and name:sub(-#suffix):lower() == suffix:lower() then
      name = name:sub(1, #name - #suffix)
    end
  end
  return name
end

-- Same rule as the tool: no case, spaces and hyphens alike.
local function key(name)
  return (string.lower(shortName(name) or ""):gsub("[%s%-]+", "-"))
end
NPR.Key = key

function NPR:Print(msg)
  DEFAULT_CHAT_FRAME:AddMessage("|cff6cc3ffNP Roster|r: " .. msg)
end

-- ---------- saved data ----------
function NPR:Init()
  NPRosterDB = NPRosterDB or {}
  NPRosterDB.sessions = NPRosterDB.sessions or {}
  self.db = NPRosterDB
end

function NPR:Week() return self.db.week end

function NPR:CurrentRaid()
  local w = self.db.week
  if not w then return nil end
  return w.raids[self.db.selected or ""] or w.raids[w.order[1]]
end

-- ---------- import ----------
-- Format (from the NP Roster web tool):
--   !NPR1!
--   W;<week id>
--   R;<raid id>;<size>;<date>;<name>
--   G;<group>;Name:Class:Spec,...   (":Class:Spec" is optional, older strings have names only)
--   B;Name:Class:Spec,...
function NPR:ParseRoster(text)
  -- WoW edit boxes double any "|" typed or pasted, and older strings used "|" as separator.
  text = (text or ""):gsub("||", "|"):gsub("|", ";"):gsub("\r", "")
  local lines = {}
  for line in text:gmatch("[^\n]+") do
    line = trim(line)
    if line ~= "" then lines[#lines + 1] = line end
  end
  if lines[1] ~= "!NPR1!" then
    return nil, "That is not an NP Roster string. It should start with !NPR1!."
  end
  local week = { raids = {}, order = {} }
  local cur
  for i = 2, #lines do
    local f = splitFields(lines[i])
    if f[1] == "W" then
      week.id = f[2]
    elseif f[1] == "R" then
      cur = { id = f[2], size = tonumber(f[3]) or 20, date = f[4] or "", name = f[5] or f[2], groups = {}, bench = {}, info = {} }
      week.raids[cur.id] = cur
      week.order[#week.order + 1] = cur.id
    elseif f[1] == "G" and cur then
      local g = tonumber(f[2])
      if g then cur.groups[g] = self:ParsePlayers(cur, f[3]) end
    elseif f[1] == "B" and cur then
      cur.bench = self:ParsePlayers(cur, f[2])
    end
  end
  if #week.order == 0 then
    return nil, "The string has no raids in it. Plan the week in the tool before exporting."
  end
  return week
end

-- "Name:Class:Spec" entries -> list of names; class and spec are kept in raid.info by name key.
function NPR:ParsePlayers(raid, s)
  local names = {}
  for _, entry in ipairs(splitList(s)) do
    local name, cls, spec = entry:match("^([^:]+):?([^:]*):?([^:]*)$")
    name = trim(name or entry)
    names[#names + 1] = name
    if cls and cls ~= "" then raid.info[key(name)] = { class = string.upper(cls), spec = spec } end
  end
  return names
end

-- Class file name (e.g. "WARRIOR") from the roster string, the raid or the guild roster.
function NPR:ClassOf(raid, name, members, guild)
  local k = key(name)
  local i = raid and raid.info and raid.info[k]
  if i and i.class then return i.class end
  local m = members and members[k]
  if m and m.class then return m.class end
  local g = guild and guild[k]
  return g and g.class
end

function NPR:Import(text)
  local week, err = self:ParseRoster(text)
  if not week then return false, err end
  self.db.week = week
  self.db.selected = week.order[1]
  local parts = {}
  for _, id in ipairs(week.order) do
    local r = week.raids[id]
    parts[#parts + 1] = string.format("%s (%s)", r.name, r.date)
  end
  return true, "Imported " .. table.concat(parts, ", ")
end

-- ---------- live state ----------
-- name key -> { name, group, index, online, class }
function NPR:RaidMembers()
  local out = {}
  if IsInRaid() then
    for i = 1, GetNumGroupMembers() do
      local name, _, subgroup, _, _, classFile, _, online = GetRaidRosterInfo(i)
      if name then out[key(name)] = { name = shortName(name), group = subgroup, index = i, online = online, class = classFile } end
    end
  elseif IsInGroup() then
    local units = { "player", "party1", "party2", "party3", "party4" }
    for _, u in ipairs(units) do
      if UnitExists(u) then
        local name = GetUnitName(u, true)
        local _, classFile = UnitClass(u)
        out[key(name)] = { name = shortName(name), group = 1, online = UnitIsConnected(u), class = classFile }
      end
    end
  end
  return out
end

-- name key -> { online, class }
function NPR:GuildStatus()
  local out = {}
  if not IsInGuild() then return out end
  for i = 1, GetNumGuildMembers() do
    local name, _, _, _, _, _, _, _, online, _, classFile = GetGuildRosterInfo(i)
    if name then out[key(name)] = { online = online, class = classFile } end
  end
  return out
end

function NPR:RequestGuild()
  if IsInGuild() and GuildRosterFn then GuildRosterFn() end
end

-- Target subgroup for each roster name.
-- A bench player who replaces a no-show takes over that player's group.
function NPR:Targets(raid)
  local t = {}
  for g, names in pairs(raid.groups) do
    for _, n in ipairs(names) do t[key(n)] = g end
  end
  for sub, orig in pairs(raid.subs or {}) do
    local g = t[key(orig)]
    if g then t[key(sub)] = g; t[key(orig)] = nil end
  end
  return t
end

-- Roster players who are not in the raid and not replaced yet, in group order.
function NPR:Missing(raid)
  local members, replaced, out = self:RaidMembers(), {}, {}
  for _, orig in pairs(raid.subs or {}) do replaced[key(orig)] = true end
  for g = 1, 8 do
    for _, n in ipairs(raid.groups[g] or {}) do
      if not members[key(n)] and not replaced[key(n)] then out[#out + 1] = n end
    end
  end
  return out
end

-- The bench comes from the tool with the player most owed a spot first.
function NPR:NextBench(raid)
  local members, guild, used = self:RaidMembers(), self:GuildStatus(), {}
  for sub in pairs(raid.subs or {}) do used[key(sub)] = true end
  for _, n in ipairs(raid.bench) do
    local k = key(n)
    local g = guild[k]
    if not members[k] and not used[k] and (not g or g.online) then return n end
  end
end

function NPR:ReplaceNoShow(raid)
  if not raid then return self:Print("Import a roster first.") end
  local missing = self:Missing(raid)[1]
  if not missing then return self:Print("Everyone on the roster is in the raid.") end
  local sub = self:NextBench(raid)
  if not sub then return self:Print("No bench player is online in game. Ask on Discord.") end
  raid.subs = raid.subs or {}
  raid.subs[sub] = missing
  InviteUnitFn(sub)
  self:Print(string.format("Inviting %s from the bench for %s (group %d).", sub, missing, self:Targets(raid)[key(sub)] or 0))
  if ns.UI then ns.UI:Refresh() end
end

function NPR:CanLead()
  return UnitIsGroupLeader("player") or (IsInRaid() and UnitIsGroupAssistant("player"))
end

-- ---------- invites ----------
function NPR:InviteRoster(raid)
  if not raid then return self:Print("Import a roster first.") end
  if IsInGroup() and not UnitIsGroupLeader("player") and not (IsInRaid() and UnitIsGroupAssistant("player")) then
    return self:Print("You need to be raid leader or assist to invite.")
  end
  local members, guild = self:RaidMembers(), self:GuildStatus()
  local me = key(UnitName("player"))
  local queue, offline = {}, {}
  for g, names in pairs(raid.groups) do
    for _, n in ipairs(names) do
      local k = key(n)
      if k ~= me and not members[k] then
        if guild[k] and not guild[k].online then offline[#offline + 1] = n else queue[#queue + 1] = n end
      end
    end
  end
  self.inviteQueue = queue
  self.firstWaveSent = false
  if #offline > 0 then self:Print("Offline: " .. table.concat(offline, ", ")) end
  if #queue == 0 then return self:Print("Everyone online is already in the group.") end
  self:Print(string.format("Inviting %d players.", #queue))
  self:ProcessInvites()
end

-- A party holds 5, so invite 4, convert to raid as soon as someone joins, then invite the rest.
function NPR:ProcessInvites()
  local q = self.inviteQueue
  if not q or #q == 0 then return end
  if IsInRaid() then
    while #q > 0 do InviteUnitFn(table.remove(q, 1)) end
  elseif IsInGroup() then
    if UnitIsGroupLeader("player") then ConvertToRaidFn() end
  elseif not self.firstWaveSent then
    for _ = 1, math.min(4, #q) do InviteUnitFn(table.remove(q, 1)) end
    self.firstWaveSent = true
  end
end

-- ---------- group sorting ----------
-- One move per roster update: the server applies moves one at a time.
function NPR:SortStep()
  local raid = self.sortRaid
  if not raid then return end
  if InCombatLockdown() then
    self.sortWaitingCombat = true
    return
  end
  if not IsInRaid() then self.sortRaid = nil return end
  self.sortSteps = (self.sortSteps or 0) + 1
  if self.sortSteps > SORT_MAX_STEPS then
    self.sortRaid = nil
    return self:Print("Stopped sorting after too many moves. Try again.")
  end
  local targets = self:Targets(raid)
  local members = self:RaidMembers()
  local nGroups = math.ceil((raid.size or 20) / 5)
  -- If WoW refuses a move, no roster update follows: stop instead of resuming at a random later update.
  local step = self.sortSteps
  C_Timer.After(4, function()
    if NPR.sortRaid and NPR.sortSteps == step and not NPR.sortWaitingCombat then
      NPR.sortRaid = nil
      NPR:Print("Sorting stopped: the last move did not go through. Check that you are leader or assist and try again.")
    end
  end)
  local count, byGroup = {}, {}
  for g = 1, 8 do count[g] = 0; byGroup[g] = {} end
  for k, m in pairs(members) do
    count[m.group] = count[m.group] + 1
    table.insert(byGroup[m.group], k)
  end
  -- Roster group for a player; nil for players who are not on the roster.
  local function wanted(k)
    return targets[k]
  end
  for k, m in pairs(members) do
    local want = wanted(k)
    if want and m.group ~= want then
      if count[want] < 5 then
        SetRaidSubgroup(m.index, want)
        return
      end
      for _, other in ipairs(byGroup[want]) do
        if wanted(other) ~= want then
          SwapRaidSubgroup(m.index, members[other].index)
          return
        end
      end
    end
  end
  -- Extras sitting in roster groups: move them out to make room.
  for k, m in pairs(members) do
    if not wanted(k) and m.group <= nGroups then
      for g = nGroups + 1, 8 do
        if count[g] < 5 then
          SetRaidSubgroup(m.index, g)
          return
        end
      end
    end
  end
  self.sortRaid = nil
  self:Print("Groups are sorted.")
  if ns.UI then ns.UI:Refresh() end
end

function NPR:SortGroups(raid)
  if not raid then return self:Print("Import a roster first.") end
  if not IsInRaid() then return self:Print("You need to be in a raid to sort groups.") end
  if not self:CanLead() then return self:Print("You need to be raid leader or assist to move players.") end
  self.sortRaid = raid
  self.sortSteps = 0
  if InCombatLockdown() then
    self.sortWaitingCombat = true
    return self:Print("In combat. Sorting starts when combat ends.")
  end
  self:SortStep()
end

-- ---------- bench whisper ----------
-- Bench players only need to be reachable on Discord, so this reaches the ones who happen to be in game.
function NPR:WhisperBench(raid)
  if not raid then return end
  local guild = self:GuildStatus()
  local n = 0
  for _, name in ipairs(raid.bench) do
    local g = guild[key(name)]
    if g and g.online then
      SendChatMessage(string.format("You are on the bench for %s tonight. Stay available on Discord in case we need you, and you get DKP.", raid.name), "WHISPER", nil, name)
      n = n + 1
    end
  end
  self:Print(string.format("Whispered %d bench players who are online. The rest see the bench on Discord.", n))
end

-- ---------- attendance ----------
function NPR:Tracking() return self.db.tracking end

function NPR:StartTracking(raid)
  if not raid then return self:Print("Import a roster first.") end
  local w = self.db.week
  self.db.tracking = {
    rid = raid.id, week = w and w.id or "", date = raid.date, name = raid.name, size = raid.size,
    start = time(), seen = {}, bench = {},
  }
  for _, n in ipairs(raid.bench) do self.db.tracking.bench[#self.db.tracking.bench + 1] = n end
  self:Snapshot()
  self:Print("Tracking attendance for " .. raid.name .. ". Press End raid when you are done.")
end

function NPR:Snapshot()
  local t = self.db.tracking
  if not t then return end
  local now = time()
  for _, m in pairs(self:RaidMembers()) do
    if m.online and not t.seen[m.name] then t.seen[m.name] = now end
  end
end

function NPR:EndTracking()
  local t = self.db.tracking
  if not t then return end
  self:Snapshot()
  t.finish = time()
  table.insert(self.db.sessions, 1, t)
  while #self.db.sessions > 12 do table.remove(self.db.sessions) end
  self.db.tracking = nil
  self:Print("Attendance saved. Open Attendance and copy the string into the tool.")
  return t
end

-- Everyone on the planned bench who did not play counts as bench: they only had to be available
-- on Discord. Officers mark a bench no-show in the tool.
function NPR:ExportAttendance(t)
  local present, late, bench = {}, {}, {}
  local seenKeys = {}
  for name, first in pairs(t.seen) do
    present[#present + 1] = name
    seenKeys[key(name)] = true
    if first - t.start > LATE_SECONDS then late[#late + 1] = name end
  end
  for _, n in ipairs(t.bench) do
    if not seenKeys[key(n)] then bench[#bench + 1] = n end
  end
  table.sort(present); table.sort(late); table.sort(bench)
  return table.concat({
    "!NPA1!",
    string.format("R;%s;%s;%s", t.rid or "", t.week or "", t.date or ""),
    "P;" .. table.concat(present, ","),
    "B;" .. table.concat(bench, ","),
    "L;" .. table.concat(late, ","),
  }, "\n")
end

-- ---------- events ----------
local ev = CreateFrame("Frame")
ev:RegisterEvent("ADDON_LOADED")
ev:RegisterEvent("GROUP_ROSTER_UPDATE")
ev:RegisterEvent("GUILD_ROSTER_UPDATE")
ev:RegisterEvent("PLAYER_REGEN_ENABLED")
ev:RegisterEvent("PLAYER_LOGIN")
ev:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == ADDON then
    NPR:Init()
  elseif event == "PLAYER_LOGIN" then
    NPR:RequestGuild()
  elseif event == "GROUP_ROSTER_UPDATE" then
    NPR:ProcessInvites()
    NPR:Snapshot()
    if NPR.sortRaid then C_Timer.After(0.3, function() NPR:SortStep() end) end
    if ns.UI then ns.UI:Refresh() end
  elseif event == "GUILD_ROSTER_UPDATE" then
    if ns.UI then ns.UI:Refresh() end
  elseif event == "PLAYER_REGEN_ENABLED" then
    if NPR.sortWaitingCombat then
      NPR.sortWaitingCombat = false
      NPR:SortStep()
    end
  end
end)

SLASH_NPROSTER1 = "/nproster"
SLASH_NPROSTER2 = "/npr"
SlashCmdList.NPROSTER = function(msg)
  msg = trim(msg or ""):lower()
  local raid = NPR:CurrentRaid()
  if msg == "invite" then NPR:InviteRoster(raid)
  elseif msg == "sort" then NPR:SortGroups(raid)
  elseif msg == "bench" then NPR:WhisperBench(raid)
  elseif msg == "replace" then NPR:ReplaceNoShow(raid)
  else ns.UI:Toggle() end
end
