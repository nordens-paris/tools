-- NP Roster window: Import, Raid and Attendance panes.
local ADDON, ns = ...
local NPR = ns.NPR
local UI = {}
ns.UI = UI

local GREEN, YELLOW, WHITE, GREY, ORANGE = "|cff40ff40", "|cffffd100", "|cffffffff", "|cff808080", "|cffff8040"

-- Status in front of each name, so the name itself can carry the class colour.
local ST_IN = "|TInterface\\RaidFrame\\ReadyCheck-Ready:12:12|t"
local ST_MOVE = "|TInterface\\RaidFrame\\ReadyCheck-Waiting:12:12|t"
local ST_ONLINE = "|TInterface\\FriendsFrame\\StatusIcon-Online:12:12|t"
local ST_OFFLINE = "|TInterface\\FriendsFrame\\StatusIcon-Offline:12:12|t"
local ST_UNKNOWN = ORANGE .. "?|r"
local CLASS_TEX = "Interface\\GLUES\\CHARACTERCREATE\\UI-CHARACTERCREATE-CLASSES"

local function classIcon(classFile)
  local c = CLASS_ICON_TCOORDS and classFile and CLASS_ICON_TCOORDS[classFile]
  if not c then return "" end
  local px = function(v) return math.floor(v * 256 + 0.5) end
  return string.format("|T%s:14:14:0:0:256:256:%d:%d:%d:%d|t", CLASS_TEX, px(c[1]), px(c[2]), px(c[3]), px(c[4]))
end

local function classColor(classFile)
  local c = RAID_CLASS_COLORS and classFile and RAID_CLASS_COLORS[classFile]
  if not c then return WHITE end
  if c.colorStr then return "|c" .. c.colorStr end
  return string.format("|cff%02x%02x%02x", math.floor(c.r * 255), math.floor(c.g * 255), math.floor(c.b * 255))
end

local function Button(parent, text, width, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(width or 100, 22)
  b:SetText(text)
  b:SetScript("OnClick", onClick)
  return b
end

local function Text(parent, font, width)
  local fs = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
  fs:SetJustifyH("LEFT")
  if width then fs:SetWidth(width) end
  return fs
end

local function ScrollEdit(parent, w, h)
  local bg = CreateFrame("Frame", nil, parent, "BackdropTemplate")
  bg:SetSize(w + 34, h + 12)
  bg:SetBackdrop({
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 16,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
  })
  bg:SetBackdropColor(0, 0, 0, 0.7)
  local sf = CreateFrame("ScrollFrame", nil, bg, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 6, -6)
  sf:SetSize(w, h)
  local eb = CreateFrame("EditBox", nil, sf)
  eb:SetMultiLine(true)
  eb:SetAutoFocus(false)
  eb:SetFontObject(ChatFontNormal)
  eb:SetWidth(w)
  eb:SetMaxLetters(0)
  eb:SetScript("OnEscapePressed", eb.ClearFocus)
  sf:SetScrollChild(eb)
  bg:EnableMouse(true)
  bg:SetScript("OnMouseDown", function() eb:SetFocus() end)
  return bg, eb
end

function UI:Build()
  if self.frame then return end
  local f = CreateFrame("Frame", "NPRosterFrame", UIParent, "BackdropTemplate")
  f:SetSize(620, 514)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  f:Hide()
  tinsert(UISpecialFrames, "NPRosterFrame")
  self.frame = f

  local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", -6, -6)

  -- The guild emblem beside the title.
  local emblem = f:CreateTexture(nil, "ARTWORK")
  emblem:SetSize(46, 46)
  emblem:SetPoint("TOPLEFT", 14, -8)
  emblem:SetTexture("Interface\\AddOns\\" .. ADDON .. "\\emblem")
  local title = Text(f, "GameFontNormalLarge")
  title:SetPoint("LEFT", emblem, "RIGHT", 6, 0)
  title:SetText("NP Roster")
  self.sub = Text(f, "GameFontDisableSmall")
  self.sub:SetPoint("LEFT", title, "RIGHT", 10, -1)

  self.panes = {}
  local tabs = { { "import", "Import" }, { "raid", "Raid" }, { "attendance", "Attendance" } }
  local prev
  for _, t in ipairs(tabs) do
    local b = Button(f, t[2], 110, function() UI:Show(t[1]) end)
    if prev then b:SetPoint("LEFT", prev, "RIGHT", 6, 0) else b:SetPoint("TOPLEFT", 18, -56) end
    prev = b
    local p = CreateFrame("Frame", nil, f)
    p:SetPoint("TOPLEFT", 20, -88)
    p:SetPoint("BOTTOMRIGHT", -20, 18)
    p:Hide()
    self.panes[t[1]] = p
  end

  self:BuildImport(self.panes.import)
  self:BuildRaid(self.panes.raid)
  self:BuildAttendance(self.panes.attendance)
end

-- ---------- Import ----------
function UI:BuildImport(p)
  local help = Text(p, "GameFontHighlight", 560)
  help:SetPoint("TOPLEFT", 0, 0)
  help:SetText("Copy the addon string from the NP Roster tool (Share the roster), click the box and paste with Ctrl+V.")
  local box, eb = ScrollEdit(p, 540, 280)
  box:SetPoint("TOPLEFT", help, "BOTTOMLEFT", 0, -8)
  self.importBox = eb
  local status = Text(p, "GameFontHighlightSmall", 560)
  status:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 2, -34)
  local imp = Button(p, "Import", 120, function()
    local ok, msg = NPR:Import(eb:GetText())
    status:SetText((ok and GREEN or ORANGE) .. msg .. "|r")
    if ok then
      eb:SetText("")
      eb:ClearFocus()
      UI:Show("raid")
    end
  end)
  imp:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 0, -6)
  local clear = Button(p, "Clear", 80, function() eb:SetText("") status:SetText("") end)
  clear:SetPoint("LEFT", imp, "RIGHT", 6, 0)
end

-- ---------- Raid ----------
function UI:BuildRaid(p)
  self.raidButtons = {}
  for i = 1, 4 do
    local b = Button(p, "", 130, function(btn)
      NPR.db.selected = btn.raidId
      UI:Refresh()
    end)
    b:SetPoint("TOPLEFT", (i - 1) * 136, 0)
    self.raidButtons[i] = b
  end
  self.raidInfo = Text(p, "GameFontNormal", 570)
  self.raidInfo:SetPoint("TOPLEFT", 0, -30)

  self.groupCells = {}
  for g = 1, 8 do
    local col, row = (g - 1) % 4, math.floor((g - 1) / 4)
    local head = Text(p, "GameFontNormalSmall", 135)
    head:SetPoint("TOPLEFT", col * 143, -54 - row * 110)
    local lines = {}
    for i = 1, 5 do
      local fs = Text(p, "GameFontHighlightSmall", 138)
      fs:SetWordWrap(false)
      fs:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 0, -3 - (i - 1) * 16)
      lines[i] = fs
    end
    self.groupCells[g] = { head = head, lines = lines }
  end
  self.benchText = Text(p, "GameFontHighlightSmall", 570)
  self.benchText:SetPoint("TOPLEFT", 0, -282)
  self.benchText:SetWordWrap(true)
  self.extraText = Text(p, "GameFontHighlightSmall", 570)
  self.extraText:SetPoint("TOPLEFT", self.benchText, "BOTTOMLEFT", 0, -4)
  local legend = Text(p, "GameFontDisableSmall", 570)
  legend:SetPoint("BOTTOMLEFT", 0, 30)
  legend:SetText(ST_IN .. " In place   " .. ST_MOVE .. " Wrong group   " .. ST_ONLINE .. " Online, not in raid   " .. ST_OFFLINE .. " Offline   " .. ST_UNKNOWN .. " Not found in guild")

  local inv = Button(p, "Invite", 90, function() NPR:InviteRoster(NPR:CurrentRaid()) end)
  inv:SetPoint("BOTTOMLEFT", 0, 0)
  local sort = Button(p, "Sort groups", 100, function() NPR:SortGroups(NPR:CurrentRaid()) end)
  sort:SetPoint("LEFT", inv, "RIGHT", 6, 0)
  local bench = Button(p, "Whisper bench", 110, function() NPR:WhisperBench(NPR:CurrentRaid()) end)
  bench:SetPoint("LEFT", sort, "RIGHT", 6, 0)
  local replace = Button(p, "Replace no-show", 120, function() NPR:ReplaceNoShow(NPR:CurrentRaid()) end)
  replace:SetPoint("LEFT", bench, "RIGHT", 6, 0)
  replace:SetScript("OnEnter", function(b)
    GameTooltip:SetOwner(b, "ANCHOR_TOP")
    GameTooltip:SetText("Invites the next bench player who is online, in the order from the tool, into the group of the first roster player who is missing.", nil, nil, nil, nil, true)
    GameTooltip:Show()
  end)
  replace:SetScript("OnLeave", GameTooltip_Hide)
  bench:SetScript("OnEnter", function(b)
    GameTooltip:SetOwner(b, "ANCHOR_TOP")
    GameTooltip:SetText("Whispers the bench players who are online in game. Everyone else sees the bench on Discord.", nil, nil, nil, nil, true)
    GameTooltip:Show()
  end)
  bench:SetScript("OnLeave", GameTooltip_Hide)
  self.trackBtn = Button(p, "Start raid", 100, function()
    if NPR:Tracking() then
      NPR:EndTracking()
      UI:Show("attendance")
    else
      NPR:StartTracking(NPR:CurrentRaid())
    end
    UI:Refresh()
  end)
  self.trackBtn:SetPoint("BOTTOMRIGHT", 0, 0)
end

-- "<status> <class icon> <name in class colour>". The status comes first so a long name that is
-- cut off at the column edge never hides it.
local function playerText(raid, name, want, members, guild)
  local k = NPR.Key(name)
  local m, g = members[k], guild[k]
  local status
  if m then
    if not m.online then status = ST_OFFLINE
    elseif want and m.group ~= want then status = ST_MOVE
    else status = ST_IN end
  elseif not g then status = ST_UNKNOWN
  else status = g.online and ST_ONLINE or ST_OFFLINE end
  local cls = NPR:ClassOf(raid, name, members, guild)
  return status .. " " .. classIcon(cls) .. " " .. classColor(cls) .. name .. "|r"
end

function UI:RefreshRaid()
  local w = NPR:Week()
  local raid = NPR:CurrentRaid()
  for i, b in ipairs(self.raidButtons) do
    local id = w and w.order[i]
    if id then
      b.raidId = id
      b:SetText(w.raids[id].name)
      b:Show()
      if raid and raid.id == id then b:LockHighlight() else b:UnlockHighlight() end
    else
      b:Hide()
    end
  end
  if not raid then
    self.raidInfo:SetText("No roster yet. Import one first.")
    for g = 1, 8 do
      self.groupCells[g].head:SetText("")
      for i = 1, 5 do self.groupCells[g].lines[i]:SetText("") end
    end
    self.benchText:SetText("")
    self.extraText:SetText("")
    return
  end
  local members, guild = NPR:RaidMembers(), NPR:GuildStatus()
  local targets = NPR:Targets(raid)
  local nGroups = math.ceil((raid.size or 20) / 5)
  local planned, inPlace = 0, 0
  for g = 1, 8 do
    local cell = self.groupCells[g]
    local names = raid.groups[g] or {}
    cell.head:SetText(g <= nGroups and ("Group " .. g) or "")
    for i = 1, 5 do
      local n = names[i]
      if n and g <= nGroups then
        planned = planned + 1
        local m = members[NPR.Key(n)]
        if m and m.group == g then inPlace = inPlace + 1 end
        local sub
        for s, orig in pairs(raid.subs or {}) do if NPR.Key(orig) == NPR.Key(n) then sub = s end end
        if sub then
          cell.lines[i]:SetText(playerText(raid, sub, g, members, guild) .. GREY .. " for " .. n .. "|r")
        else
          cell.lines[i]:SetText(playerText(raid, n, g, members, guild))
        end
      else
        cell.lines[i]:SetText("")
      end
    end
  end
  self.raidInfo:SetText(string.format("%s  |cffaaaaaa%s|r   %d of %d in place", raid.name, raid.date or "", inPlace, planned))
  local bench = {}
  for _, n in ipairs(raid.bench) do bench[#bench + 1] = playerText(raid, n, nil, members, guild) end
  self.benchText:SetText(#bench > 0 and ("Bench: " .. table.concat(bench, ", ")) or "Bench: nobody")
  local extras = {}
  for k, m in pairs(members) do
    if not targets[k] then extras[#extras + 1] = classIcon(m.class) .. " " .. classColor(m.class) .. m.name .. "|r" end
  end
  table.sort(extras)
  self.extraText:SetText(#extras > 0 and (YELLOW .. "In raid but not on the roster:|r " .. table.concat(extras, ", ")) or "")
  self.trackBtn:SetText(NPR:Tracking() and "End raid" or "Start raid")
end

-- ---------- Attendance ----------
function UI:BuildAttendance(p)
  self.trackText = Text(p, "GameFontHighlight", 570)
  self.trackText:SetPoint("TOPLEFT", 0, 0)
  self.sessionButtons = {}
  for i = 1, 6 do
    local b = Button(p, "", 280, function(btn) UI:ShowSession(btn.index) end)
    b:SetPoint("TOPLEFT", ((i - 1) % 2) * 290, -24 - math.floor((i - 1) / 2) * 26)
    self.sessionButtons[i] = b
  end
  local help = Text(p, "GameFontHighlightSmall", 570)
  help:SetPoint("TOPLEFT", 0, -108)
  help:SetText("Click the box, press Ctrl+A then Ctrl+C, and paste it on the Attendance tab of the tool.")
  local box, eb = ScrollEdit(p, 540, 200)
  box:SetPoint("TOPLEFT", help, "BOTTOMLEFT", 0, -6)
  eb:SetScript("OnEditFocusGained", function(e) e:HighlightText() end)
  -- Keep the export read-only: typing restores the text.
  eb:SetScript("OnTextChanged", function(e, user) if user and UI.exportText then e:SetText(UI.exportText) e:HighlightText() end end)
  self.exportBox = eb
end

function UI:ShowSession(i)
  local s = NPR.db.sessions[i]
  if not s then return end
  self.exportText = NPR:ExportAttendance(s)
  self.exportBox:SetText(self.exportText)
  self.exportBox:SetFocus()
  self.exportBox:HighlightText()
end

function UI:RefreshAttendance()
  local t = NPR:Tracking()
  if t then
    local n = 0
    for _ in pairs(t.seen) do n = n + 1 end
    self.trackText:SetText(string.format("Tracking %s since %s: %d seen. End it on the Raid tab.", t.name, date("%H:%M", t.start), n))
  else
    self.trackText:SetText("Not tracking. Press Start raid on the Raid tab when the raid begins.")
  end
  for i, b in ipairs(self.sessionButtons) do
    local s = NPR.db.sessions[i]
    if s then
      local n = 0
      for _ in pairs(s.seen) do n = n + 1 end
      b.index = i
      b:SetText(string.format("%s %s (%d)", s.name or "?", s.date or "", n))
      b:Show()
    else
      b:Hide()
    end
  end
end

-- ---------- general ----------
function UI:Show(which)
  self:Build()
  self.current = which
  for k, p in pairs(self.panes) do p:SetShown(k == which) end
  self.frame:Show()
  NPR:RequestGuild()
  self:Refresh()
end

function UI:Toggle()
  self:Build()
  if self.frame:IsShown() then self.frame:Hide() else self:Show(self.current or (NPR:Week() and "raid" or "import")) end
end

function UI:Refresh()
  if not self.frame or not self.frame:IsShown() then return end
  local w = NPR:Week()
  self.sub:SetText(w and w.id and ("Week of " .. w.id) or "")
  if self.current == "raid" then self:RefreshRaid()
  elseif self.current == "attendance" then self:RefreshAttendance() end
end
