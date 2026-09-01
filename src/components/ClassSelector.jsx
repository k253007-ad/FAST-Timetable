import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { splitClassValue, formatClassLabel } from '../utils/courseColors.js';
import {
  buildMoveOverrides,
  cleanRoom,
  DAY_ORDER,
  formatSlot,
  getAllTimeSlots,
  getClassOccurrences,
  getRoomOptions,
  locateRoom,
  resolveRoomSelection,
} from '../utils/schedule.js';
import { IconAlert, IconChevronDown, IconInfo, IconPin, IconSearch, IconX } from './Icons.jsx';

// Memoized so toggling one checkbox doesn't force React to re-diff every
// other row in a list that can run into the hundreds (all courses, unfiltered).
const CourseOptionRow = memo(({ value, checked, onToggle }) => {
  const { course, section } = splitClassValue(value);
  return (
    <label className={`option-row${checked ? ' is-checked' : ''}`}>
      <input
        type="checkbox"
        className="option-checkbox"
        value={value}
        checked={checked}
        onChange={onToggle}
      />
      <span className="option-text">
        <span className="option-course">{course}</span>
        {section && <span className="option-section">{section}</span>}
      </span>
    </label>
  );
});
CourseOptionRow.displayName = 'CourseOptionRow';

// The single right-side icon slot shared by both search boxes: a plain
// search icon while empty, or a clear (X) button the instant there's a
// query — no focus-dependent delay, so it's never a beat behind what you
// just typed. Dismissing the mobile keyboard is handled separately by the
// input itself (type="search" + enterKeyHint="search" + blur-on-Enter below),
// not by this icon.
const SearchAction = ({ query, onClear }) => {
  if (!query) {
    return (
      <span className="combobox-action" aria-hidden="true">
        <IconSearch size={17} />
      </span>
    );
  }
  return (
    <button type="button" className="combobox-action combobox-action-btn" aria-label="Clear search" onClick={onClear}>
      <IconX size={15} />
    </button>
  );
};

// Shared by both info popovers (reschedule + extra-class) below — closes on
// a pointerdown outside `ref`'s element or on Escape.
const useDismissOnOutside = (isOpen, onClose, ref) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, ref]);
};

// Rendering the full unfiltered list (800+ courses) as real DOM nodes is the
// actual source of occasional lag when the dropdown first opens or the
// search is cleared back to empty — capping how many rows mount at once
// keeps that instant regardless of device, and narrowing the search below
// this threshold reveals the rest immediately (nothing is hidden, just not
// rendered until it's relevant).
const MAX_VISIBLE_RESULTS = 60;

// Teacher mode only — plain add/remove-as-a-group checkbox row, unchanged by
// the "keep synced" feature below (Teacher was never in scope for it).
const GroupOptionRow = memo(({ name, count, checked, onToggle }) => (
  <label className={`option-row${checked ? ' is-checked' : ''}`}>
    <input
      type="checkbox"
      className="option-checkbox"
      value={name}
      checked={checked}
      onChange={onToggle}
    />
    <span className="option-text">
      <span className="option-course">{name}</span>
      <span className="option-section">
        {count} class{count === 1 ? '' : 'es'}
      </span>
    </span>
  </label>
));
GroupOptionRow.displayName = 'GroupOptionRow';

// Roll No / Section mode rows — no checkbox: clicking a row directly makes
// it the profile's synced source (replacing whatever's currently selected),
// rather than toggling its classes in/out of an independent selection. See
// the "keep synced" doc comment below for why there's no separate
// select-vs-sync distinction any more.
const SyncOptionRow = memo(({ name, count, active, onSelect }) => (
  <button type="button" value={name} className={`option-row option-row-sync${active ? ' is-checked' : ''}`} onClick={onSelect}>
    <span className="option-text">
      <span className="option-course">{name}</span>
      <span className="option-section">
        {count} class{count === 1 ? '' : 'es'}
      </span>
    </span>
    {active && (
      <span className="option-active-tag">
        <IconPin size={11} /> Synced
      </span>
    )}
  </button>
));
SyncOptionRow.displayName = 'SyncOptionRow';

// Single-select searchable course picker for "Add extra class" — the same
// combobox pattern (search input + dropdown panel of real rows) as the
// Course tab's own search, added 2026-09-01 to replace a plain native
// <select> there: a native <select>'s long option text (course names run
// well past 40 characters) could overflow a narrow phone screen, where this
// custom panel just wraps it in `.option-course` like every other list in
// this app already does. Closed, the input shows the current pick's label;
// focusing it clears to a blank search box, and choosing a row closes the
// panel and restores the (new) pick's label — same show-selection-when-
// closed convention as a normal <select>, just rendered with this app's own
// searchable list instead of the OS's.
const CourseCombobox = ({ options, value, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const panelId = useId();

  useDismissOnOutside(open, () => setOpen(false), wrapRef);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return options;
    return options.filter((v) => {
      const haystack = v.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [options, query]);

  const closeAndRestore = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="combobox" ref={wrapRef}>
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        className="combobox-input"
        placeholder="Search course"
        value={open ? query : value ? formatClassLabel(value) : ''}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') closeAndRestore();
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Course for the extra class"
        autoComplete="off"
        spellCheck="false"
      />
      <SearchAction query={open ? query : ''} onClear={() => setQuery('')} />

      {open && (
        <div className="combobox-panel" id={panelId} role="group" aria-label="Matching courses">
          <div className="combobox-meta">
            {filtered.length === options.length
              ? `${options.length} of your classes`
              : `${filtered.length} of ${options.length}`}
          </div>
          <div className="combobox-list">
            {filtered.length === 0 ? (
              <div className="combobox-empty">No classes match “{query}”.</div>
            ) : (
              filtered.slice(0, MAX_VISIBLE_RESULTS).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`option-row option-row-sync${v === value ? ' is-checked' : ''}`}
                  onClick={() => {
                    onChange(v);
                    closeAndRestore();
                  }}
                >
                  <span className="option-text">
                    <span className="option-course">{formatClassLabel(v)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// A labeled row of directly-tappable option buttons — the on-screen
// alternative to a native <select> used throughout the "Adjust class times"
// edit panel (added 2026-09-01: "many people dont want... options in
// dropdown", every choice should be visible and one-tap instead of hidden
// behind an OS dropdown). `options` is `[{ value, label }]`; exactly one is
// ever active at a time (radio semantics), enforced visually via
// `.is-active`, not by disabling the others.
const PillOptions = ({ label, options, value, onChange, ariaLabel }) => (
  <div className="room-field">
    {label && <span className="room-field-label">{label}</span>}
    <div className="pill-group" role="radiogroup" aria-label={ariaLabel || label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={`pill-option${opt.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

// The cascading classroom picker shared by "Adjust class times" and "Add
// extra class": Building -> Class Room/Lab -> (Class Room: Letter -> Number,
// skipped for a letter bucket with no numbered rooms, e.g. "AB1 Room LLC")
// or (Lab: a flat list of every venue in that building not named "Room").
// Purely presentational — `sel` is always the fully-resolved, valid
// selection from resolveRoomSelection, and each `on*Change` just replaces
// the relevant field(s) in the caller's own state; the caller re-resolves
// through resolveRoomSelection on next render, same derive-don't-sync
// pattern as effectiveExtraCourse/effectiveExtraSlot below. Renders as
// PillOptions (tap-to-pick buttons), not <select>s, same reasoning as above.
// Each field is its own full-width row, top to bottom (Building, then Room
// type, then Block/Number or Lab) — briefly paired left/right in
// .reschedule-field-row, reverted 2026-09-01 since the classroom picker
// specifically should read top-to-bottom, unlike Day/Slot which stays
// paired.
const RoomFields = ({ roomOptions, sel, onBuildingChange, onTypeChange, onLetterChange, onNumberChange, onLabRoomChange }) => {
  const buildingKeys = Object.keys(roomOptions).sort();
  const group = roomOptions[sel.building] || { labs: [], classes: {} };
  const hasLabs = group.labs.length > 0;
  const hasClasses = Object.keys(group.classes).length > 0;
  const classLetters = Object.keys(group.classes).sort();
  const numberedEntries = (group.classes[sel.letter] || []).filter((e) => e.number !== null);

  if (buildingKeys.length === 0) return null;

  const typeOptions = [
    hasClasses && { value: 'class', label: 'Class Room' },
    hasLabs && { value: 'lab', label: 'Lab' },
  ].filter(Boolean);

  return (
    <>
      <PillOptions
        label="Building"
        options={buildingKeys.map((b) => ({ value: b, label: b }))}
        value={sel.building}
        onChange={onBuildingChange}
      />
      <PillOptions label="Room type" options={typeOptions} value={sel.type} onChange={onTypeChange} />
      {sel.type === 'lab' ? (
        <PillOptions
          label="Lab"
          options={group.labs.map((raw) => ({ value: raw, label: cleanRoom(raw) }))}
          value={sel.labRoom}
          onChange={onLabRoomChange}
        />
      ) : (
        <>
          <PillOptions
            label="Block"
            options={classLetters.map((l) => ({ value: l, label: l }))}
            value={sel.letter}
            onChange={onLetterChange}
          />
          {numberedEntries.length > 0 && (
            <PillOptions
              label="Number"
              options={numberedEntries.map((e) => ({ value: e.number, label: e.number }))}
              value={sel.number}
              onChange={onNumberChange}
            />
          )}
        </>
      )}
    </>
  );
};

// One row in the "Adjust class times" panel — a single (Course, Section,
// Day) occurrence with its official time/room, an active override's "moved
// to" time/room if any, and the day/slot/room pickers to set or change one.
// Its own local `day`/`slot`/`roomSel` state is the *pending* pick — nothing
// happens until "Move" is clicked, so browsing the dropdowns doesn't touch
// the real schedule. Seeded once at mount from the active override (if any)
// or the occurrence's own official room — same one-time-seed limitation
// day/slot already had (doesn't re-sync if the override changes later from
// elsewhere), not a new tradeoff introduced by adding room.
//
// The row collapses to just an "Edit" button by default (added 2026-09-01,
// "many people dont want to be bombarded with alot of options" — a native
// Day/Slot/Room <select> row was still a lot to take in even collapsed to
// 3-4 controls). Clicking Edit opens a panel with Day/Slot as plain
// <select>s — **deliberately the same control as "Add extra class" uses**
// (a same-day correction: an earlier pass made these PillOptions tap-to-pick
// buttons, but the user asked for Day/Slot here to match Add extra class
// exactly) — plus the same "Change room" -> RoomFields progressive
// disclosure as before; RoomFields itself still renders as PillOptions,
// since that's shared with (and thus automatically consistent with) Add
// extra class's own room picker. `effectiveRoomSel` already defaults to the
// occurrence's own current room regardless of whether the room picker's
// ever opened, so leaving it collapsed and clicking Move is a no-op on
// Room, not an error. The edit panel starts pre-expanded only if there's
// already an active override, so reopening a customized row doesn't hide
// the fact that it has one.
const RescheduleRow = ({ occurrence, timeSlots, activeOverride, roomOptions, onMove, onReset }) => {
  const officialStart = formatSlot(occurrence.slots[0]).start;
  const officialEnd = formatSlot(occurrence.slots[occurrence.slots.length - 1]).end;
  const [editing, setEditing] = useState(() => Boolean(activeOverride));
  const [day, setDay] = useState(activeOverride ? activeOverride.newDay : occurrence.day);
  const [slot, setSlot] = useState(activeOverride ? activeOverride.newTime : occurrence.slots[0]);
  const [roomSel, setRoomSel] = useState(
    () => locateRoom(roomOptions, activeOverride?.newRoom || occurrence.room) || {}
  );
  const [showRoomPicker, setShowRoomPicker] = useState(() => Boolean(activeOverride?.newRoom));
  const effectiveRoomSel = resolveRoomSelection(roomOptions, roomSel);

  return (
    <div className="reschedule-row">
      <div className="reschedule-info">
        <span className="reschedule-course">
          {occurrence.course}
          {occurrence.section !== 'N/A' && ` (${occurrence.section})`}
        </span>
        <span className="reschedule-official">
          Official: {occurrence.day}, {officialStart}–{officialEnd} · {cleanRoom(occurrence.room)}
        </span>
        {activeOverride && (
          <span className="reschedule-moved">
            Moved to {activeOverride.newDay}, {formatSlot(activeOverride.newTime).start}
            {activeOverride.newRoom && ` · ${cleanRoom(activeOverride.newRoom)}`}
          </span>
        )}
      </div>

      {!editing && (
        <div className="reschedule-controls">
          <button type="button" className="action-btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          {activeOverride && (
            <button type="button" className="link-button" onClick={onReset}>
              Reset
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="reschedule-edit-panel">
          <div className="reschedule-field-row">
            <select
              className="reschedule-select"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-label={`New day for ${occurrence.course}`}
            >
              {DAY_ORDER.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className="reschedule-select"
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              aria-label={`New time slot for ${occurrence.course}`}
            >
              {timeSlots.map((s, i) => (
                <option key={s} value={s}>
                  {`Slot ${i + 1} · ${formatSlot(s).start}`}
                </option>
              ))}
            </select>
          </div>
          {showRoomPicker ? (
            <RoomFields
              roomOptions={roomOptions}
              sel={effectiveRoomSel}
              onBuildingChange={(building) => setRoomSel({ building })}
              onTypeChange={(type) => setRoomSel({ building: effectiveRoomSel.building, type })}
              onLetterChange={(letter) =>
                setRoomSel({ building: effectiveRoomSel.building, type: effectiveRoomSel.type, letter })
              }
              onNumberChange={(number) => setRoomSel({ ...effectiveRoomSel, number })}
              onLabRoomChange={(labRoom) => setRoomSel({ ...effectiveRoomSel, labRoom })}
            />
          ) : (
            <button type="button" className="action-btn-blue" onClick={() => setShowRoomPicker(true)}>
              Change room
            </button>
          )}
          <div className="reschedule-edit-actions">
            <button
              type="button"
              className="action-btn-blue"
              onClick={() => {
                onMove(day, slot, effectiveRoomSel.resolvedRoom);
                setEditing(false);
              }}
            >
              {activeOverride ? 'Update' : 'Move'}
            </button>
            <button type="button" className="action-btn-blue" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {activeOverride && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onReset();
                  setEditing(false);
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Searchable multi-select for course sections, with the current selection
 * shown as removable chips. Stored values keep the legacy
 * "Course - Section" format so existing saved selections keep working.
 *
 * Four selection modes (replaced the old Manual/Auto 2-tab layout on
 * 2026-08-25 — "Auto" used to nest Student-section/Teacher under one tab;
 * Section was dropped entirely at first in favor of the more precise Roll No
 * pick, then added back as its own tab on 2026-08-26 since some students
 * just want "everything BCS-3A takes" rather than one specific student):
 *  - Roll No: pick a specific student's roll number (e.g. "3068") — see
 *    "Keep synced" below, this is no longer a plain group toggle.
 *  - Course (labelled "Manual" internally — `mode` stays `'manual'`, only the
 *    tab's visible text changed 2026-08-30): pick individual course sections
 *    one at a time (original flow, unaffected by "keep synced").
 *  - Section: pick a section/cohort code (e.g. "BCS-3A") — same "keep
 *    synced" behavior as Roll No.
 *  - Teacher: pick a teacher name and every class they teach is added/
 *    removed as a group — built from `data.timetable`, the one group mode
 *    that stayed a plain toggle (never in scope for "keep synced"). (Tab
 *    order: Roll No, Course, Section, Teacher.)
 *
 * **"Keep synced" (added 2026-09-01, redesigned same day to full-replace
 * semantics)**: Roll No and Section are no longer independent multi-select
 * groups — there's exactly one profile-wide `linkedSync` (App.jsx):
 * `{ type: 'rollno'|'section', value } | null`. Clicking any row in either
 * mode (`SyncOptionRow`, no checkbox — there's no separate "just add these
 * classes once" option any more) sets it as the sync target, which
 * **replaces the whole selection** with that roll no/section's current
 * classes — not merged with whatever was selected before. App.jsx
 * re-resolves it against `data` (`getClassesForRollNo`/`getClassesForSection`
 * in schedule.js) and re-applies the same full replace on the very first
 * pick and on every later load/refresh, so a course the university adds or
 * drops for that roll no/section is picked up automatically.
 *
 * While a sync is active (added 2026-09-01, same-day follow-up), the mode
 * tabs and every search combobox are hidden entirely and replaced by one
 * `.synced-indicator` in the same spot ("Synced with Roll No 25K-3068") —
 * there's nothing left to search until you stop syncing, so showing the
 * picker UI alongside it would just be confusing. Clicking the indicator
 * opens the only way to stop syncing ("Cancel sync") plus a one-line
 * explanation; cancelling brings the mode tabs/search back (`linkedSync`
 * is the single gate — see the `!linkedSync` guards throughout the render).
 * Only one of Roll No/Section can be synced at a time — picking one
 * replaces the other, they're not additive.
 *
 * The card can also be minimized (collapses everything but the minimize
 * button + profile toolbar — the mode tabs collapse too), and holds up to
 * `profileCount` independent saved timetables
 * (e.g. "my" schedule in slot 1, a friend's in slot 2) via `activeProfile` /
 * `onSwitchProfile` — each profile's selection is a separate saved list.
 */
const ClassSelector = ({
  data,
  allClasses,
  selectedClasses,
  setSelectedClasses,
  overrides,
  setOverrides,
  extraClasses,
  setExtraClasses,
  courseColors,
  activeProfile,
  profileCount,
  onSwitchProfile,
  linkedSync,
  setLinkedSync,
}) => {
  const [mode, setMode] = useState('rollno'); // 'manual' | 'rollno' | 'teacher' | 'section'
  const [query, setQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState(''); // shared search box for roll no / teacher / section tabs
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [showChipsInfo, setShowChipsInfo] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showRescheduleInfo, setShowRescheduleInfo] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [showExtraInfo, setShowExtraInfo] = useState(false);
  const [extraCourseValue, setExtraCourseValue] = useState('');
  const [extraDay, setExtraDay] = useState(DAY_ORDER[0]);
  const [extraSlot, setExtraSlot] = useState('');
  const [extraError, setExtraError] = useState('');
  const [showExtraRoomPicker, setShowExtraRoomPicker] = useState(false);
  const [showSyncInfo, setShowSyncInfo] = useState(false);
  const comboboxRef = useRef(null);
  const inputRef = useRef(null);
  const groupInputRef = useRef(null);
  const rescheduleInfoRef = useRef(null);
  const extraInfoRef = useRef(null);
  const syncBadgeRef = useRef(null);
  const chipsInfoRef = useRef(null);
  const panelId = useId();
  const groupPanelId = useId();

  useDismissOnOutside(showRescheduleInfo, () => setShowRescheduleInfo(false), rescheduleInfoRef);
  useDismissOnOutside(showExtraInfo, () => setShowExtraInfo(false), extraInfoRef);
  useDismissOnOutside(showSyncInfo, () => setShowSyncInfo(false), syncBadgeRef);
  useDismissOnOutside(showChipsInfo, () => setShowChipsInfo(false), chipsInfoRef);

  // Close on outside click / Escape while the dropdown is open. "Outside"
  // means outside the search box + its panel — not just outside the whole
  // card — so clicking elsewhere in "My classes" (title, tabs, chips) closes it too.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Refocus first: the input's onFocus sets open=true, and the
        // close below must win when React batches the two updates.
        (mode === 'manual' ? inputRef : groupInputRef).current?.focus();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, mode]);

  // Every whitespace-separated token must match, so "cs4048 6b" works.
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return allClasses;
    return allClasses.filter((value) => {
      const haystack = value.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [allClasses, query]);

  // A stable callback (reads the toggled value off the event instead of
  // closing over it per-row) so every row can share one function reference —
  // required for CourseOptionRow's memo to actually skip re-rendering rows
  // whose checked state didn't change, which matters once `allClasses` runs
  // into the hundreds.
  const handleToggleClass = useCallback(
    (e) => {
      const { value } = e.target;
      setSelectedClasses((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
      );
    },
    [setSelectedClasses]
  );

  const removeClass = (value) => {
    setSelectedClasses((prev) => prev.filter((v) => v !== value));
  };

  // "Adjust class times" — manual per-device overrides for when the shared
  // sheet hasn't caught up with a real schedule change yet (see
  // utils/schedule.js). `occurrences` is always built from the *official*
  // schedule so an occurrence's identity never shifts out from under an
  // existing override — see getClassOccurrences's own doc comment.
  const timeSlots = useMemo(() => getAllTimeSlots(data), [data]);
  const occurrences = useMemo(() => getClassOccurrences(data, selectedClasses), [data, selectedClasses]);
  const roomOptions = useMemo(() => getRoomOptions(data), [data]);

  const findActiveOverride = (occurrence) =>
    overrides.find(
      (o) =>
        o.course === occurrence.course &&
        o.section === occurrence.section &&
        o.day === occurrence.day &&
        o.time === occurrence.slots[0]
    );

  // A course can meet more than once on the same day (e.g. a lecture plus a
  // separately-scheduled lab) — those are two distinct occurrences sharing
  // (course, section, day), so matching/removing overrides must also check
  // the occurrence's own original slots, not just the day, or moving one
  // would silently wipe out an override on the other.
  const belongsToOccurrence = (o, occurrence) =>
    o.course === occurrence.course &&
    o.section === occurrence.section &&
    o.day === occurrence.day &&
    occurrence.slots.includes(o.time);

  const handleMove = (occurrence, newDay, newStartSlot, newRoom) => {
    const entries = buildMoveOverrides(occurrence, timeSlots, newDay, newStartSlot, newRoom);
    if (!entries) {
      setMoveError(`Not enough time slots left in ${newDay} to fit this class.`);
      return;
    }
    setMoveError('');
    setOverrides((prev) => [...prev.filter((o) => !belongsToOccurrence(o, occurrence)), ...entries]);
  };

  const handleResetMove = (occurrence) => {
    setOverrides((prev) => prev.filter((o) => !belongsToOccurrence(o, occurrence)));
  };

  // "Add extra class" — a one-off session on top of the recurring schedule
  // (a makeup class, an extra revision lecture) for just this week, picked
  // from an already-selected course. There's no calendar/date model here —
  // it's a recurring weekly grid — so "just this week" is enforced by
  // App.jsx auto-removing it once its own slot has passed
  // (isExtraExpired, schedule.js), added 2026-09-01 after feedback that
  // requiring a manual delete was easy to forget.
  //
  // Both pickers fall back to a computed default rather than syncing one via
  // an effect: the course/slot lists only exist once data loads, and a
  // previously-picked course can disappear if it's removed from the
  // selection — deriving the effective value at render time keeps the
  // `<select>` always pointed at something valid without an extra render
  // pass.
  const effectiveExtraCourse = selectedClasses.includes(extraCourseValue)
    ? extraCourseValue
    : selectedClasses[0] || '';
  const effectiveExtraSlot = timeSlots.includes(extraSlot) ? extraSlot : timeSlots[0] || '';

  // The room picker (added 2026-09-01) defaults to the selected course's own
  // real room until the student actually touches a select — once they do,
  // `extraRoomSel` has a `building` and their own picks take over. Doesn't
  // re-seed from the course's room if the course is changed afterward (same
  // "sticky, no resync effect" behavior effectiveExtraSlot above already has).
  // `showExtraRoomPicker` (added same day, after "too many options" feedback)
  // keeps the 4 room selects hidden behind a "Change room" link by default —
  // most extra classes happen in the same room as usual, so the always-on
  // default (`effectiveExtraRoomSel` resolving to the course's real room) is
  // already correct without the student ever touching this.
  const extraTemplateRoom = useMemo(() => {
    if (!effectiveExtraCourse) return '';
    const { course, section } = splitClassValue(effectiveExtraCourse);
    return data?.timetable?.find((item) => item.Course === course && item.Section === section)?.Room || '';
  }, [data, effectiveExtraCourse]);
  const [extraRoomSel, setExtraRoomSel] = useState({});
  const effectiveExtraRoomSel = resolveRoomSelection(
    roomOptions,
    extraRoomSel.building ? extraRoomSel : locateRoom(roomOptions, extraTemplateRoom) || {}
  );

  const handleAddExtra = () => {
    if (!effectiveExtraCourse || !effectiveExtraSlot) return;
    const { course, section } = splitClassValue(effectiveExtraCourse);
    const alreadyAdded = extraClasses.some(
      (e) => e.course === course && e.section === section && e.day === extraDay && e.time === effectiveExtraSlot
    );
    if (alreadyAdded) {
      setExtraError('That class is already added for this day and slot.');
      return;
    }
    setExtraError('');
    setExtraClasses((prev) => [
      ...prev,
      { course, section, day: extraDay, time: effectiveExtraSlot, room: effectiveExtraRoomSel.resolvedRoom },
    ]);
  };

  const handleRemoveExtra = (extra) => {
    setExtraClasses((prev) =>
      prev.filter(
        (e) => !(e.course === extra.course && e.section === extra.section && e.day === extra.day && e.time === extra.time)
      )
    );
  };

  const hasData = allClasses.length > 0;
  const hasRollData = (data?.rollNumbers?.length ?? 0) > 0;

  // Group every class by instructor (Teacher tab), by section/cohort code
  // (Section tab), and every roll number's classes by that roll number (Roll
  // No tab), so each tab can add/remove a whole group at once.
  const { instructorGroups, sectionGroups, rollNoGroups } = useMemo(() => {
    const instructorMap = new Map();
    const sectionMap = new Map();
    (data?.timetable || []).forEach((item) => {
      const value = `${item.Course} - ${item.Section}`;
      if (item.Instructor && item.Instructor !== 'N/A') {
        if (!instructorMap.has(item.Instructor)) instructorMap.set(item.Instructor, new Set());
        instructorMap.get(item.Instructor).add(value);
      }
      if (item.Section && item.Section !== 'N/A') {
        if (!sectionMap.has(item.Section)) sectionMap.set(item.Section, new Set());
        sectionMap.get(item.Section).add(value);
      }
    });

    const rollMap = new Map();
    (data?.rollNumbers || []).forEach((item) => {
      if (!item.RollNo) return;
      const value = `${item.Course} - ${item.Section}`;
      if (!rollMap.has(item.RollNo)) rollMap.set(item.RollNo, new Set());
      rollMap.get(item.RollNo).add(value);
    });

    const toGroups = (map) =>
      [...map.entries()]
        .map(([name, classSet]) => ({ name, classes: [...classSet] }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
      instructorGroups: toGroups(instructorMap),
      sectionGroups: toGroups(sectionMap),
      rollNoGroups: toGroups(rollMap),
    };
  }, [data]);

  const groups = useMemo(() => {
    if (mode === 'rollno') return rollNoGroups;
    if (mode === 'teacher') return instructorGroups;
    if (mode === 'section') return sectionGroups;
    return [];
  }, [mode, rollNoGroups, instructorGroups, sectionGroups]);

  const filteredGroups = useMemo(() => {
    const tokens = groupQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return groups;
    return groups.filter((group) => {
      const haystack = group.name.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [groups, groupQuery]);

  const isGroupSelected = (classes) => classes.length > 0 && classes.every((c) => selectedClasses.includes(c));

  // Same stable-callback approach as handleToggleClass above: the checkbox's
  // own `value` (the group name) is looked up in `groups` inside the handler,
  // so GroupOptionRow's memo can skip re-rendering unaffected rows.
  const handleToggleGroup = useCallback(
    (e) => {
      const group = groups.find((g) => g.name === e.target.value);
      if (!group) return;
      const { classes } = group;
      setSelectedClasses((prev) => {
        const allSelected = classes.every((c) => prev.includes(c));
        if (allSelected) return prev.filter((c) => !classes.includes(c));
        return [...new Set([...prev, ...classes])];
      });
    },
    [groups, setSelectedClasses]
  );

  // Picking a row in Roll No/Section mode sets it as the profile's synced
  // source — App.jsx's effect then replaces the whole selection with that
  // group's live classes (see the "Keep synced" doc comment above). `mode`
  // is either 'rollno' or 'section' at every call site this is wired to, so
  // it doubles directly as `linkedSync.type`.
  const handleSyncSelect = useCallback(
    (e) => {
      setLinkedSync({ type: mode, value: e.currentTarget.value });
    },
    [mode, setLinkedSync]
  );

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setGroupQuery('');
    setOpen(false);
  };

  const toggleMinimized = () => {
    setOpen(false);
    setMinimized((v) => !v);
  };

  // "main" is a fixed extra slot before the numbered ones — it's the user's
  // own timetable, and the one class notifications are computed from
  // regardless of which slot is open here (see App.jsx / useClassNotifications).
  const profileIds = ['main', ...Array.from({ length: profileCount }, (_, i) => i + 1)];

  const groupUnitLabel =
    mode === 'rollno' ? 'roll numbers' : mode === 'section' ? 'sections' : 'instructors';
  const groupPlaceholder =
    mode === 'teacher'
      ? 'Search instructor name'
      : mode === 'rollno'
        ? 'Search - e.g “3068 or 3041”'
        : mode === 'section'
          ? 'Search - e.g “BCS-1A or BSE-1C”'
          : 'Search';
  const groupAriaLabel =
    mode === 'rollno' ? 'Search roll numbers' : mode === 'section' ? 'Search sections' : 'Search instructors';

  return (
    <>
      <div className="data-disclaimer no-print" role="note">
        <IconAlert size={15} />
        <span>
          This is an unofficial tool maintained independently by a student. Since
          data is updated manually, please cross-verify your schedule with official
          university announcements.
        </span>
      </div>

      <section className="card selector-card no-print">
      <div className="selector-head">
        <h2 className="selector-title">My classes</h2>
        {selectedClasses.length > 0 && (
          <span className="count-pill">{selectedClasses.length} selected</span>
        )}
        {selectedClasses.length > 0 && (
          <button type="button" className="link-button" onClick={() => setSelectedClasses([])}>
            Clear all
          </button>
        )}
      </div>

      <div className="selector-toolbar">
        <div className="toolbar-secondary">
          <button
            type="button"
            className="minimize-btn"
            onClick={toggleMinimized}
            aria-expanded={!minimized}
            aria-label={minimized ? 'Expand my classes' : 'Minimize my classes'}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            <IconChevronDown size={16} className={minimized ? undefined : 'is-flipped'} />
          </button>

          <div className="profile-tabs" role="tablist" aria-label="Timetable slot">
            {profileIds.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeProfile === id}
                className={`profile-tab${activeProfile === id ? ' is-active' : ''}${id === 'main' ? ' profile-tab-main' : ''}`}
                onClick={() => onSwitchProfile(id)}
                title={id === 'main' ? 'Main — your own timetable' : `Timetable ${id}`}
              >
                {id === 'main' ? 'Main' : id}
              </button>
            ))}
          </div>
        </div>

        {!minimized &&
          (linkedSync ? (
            <div className="synced-indicator" ref={syncBadgeRef}>
              <button
                type="button"
                className="synced-indicator-btn"
                onClick={() => setShowSyncInfo((v) => !v)}
                aria-expanded={showSyncInfo}
                aria-label={`Synced with ${linkedSync.type === 'rollno' ? 'Roll No' : 'Section'} ${linkedSync.value} — press for info and to cancel syncing`}
              >
                {linkedSync.type === 'rollno' ? 'Roll No' : 'Section'} {linkedSync.value}
              </button>
              {showSyncInfo && (
                <div className="info-popover" role="tooltip">
                  Your classes are replaced with {linkedSync.type === 'rollno' ? 'this roll number' : 'this section'}
                  &rsquo;s current schedule automatically — the first time it&rsquo;s picked, and again every time
                  the timetable refreshes. Cancel to pick classes yourself again.
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setLinkedSync(null);
                      setShowSyncInfo(false);
                    }}
                  >
                    Cancel sync
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mode-tabs" role="tablist" aria-label="Selection mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'rollno'}
                className={`mode-tab${mode === 'rollno' ? ' is-active' : ''}`}
                onClick={() => switchMode('rollno')}
              >
                Roll No
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'manual'}
                className={`mode-tab${mode === 'manual' ? ' is-active' : ''}`}
                onClick={() => switchMode('manual')}
              >
                Course
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'section'}
                className={`mode-tab${mode === 'section' ? ' is-active' : ''}`}
                onClick={() => switchMode('section')}
              >
                Section
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'teacher'}
                className={`mode-tab${mode === 'teacher' ? ' is-active' : ''}`}
                onClick={() => switchMode('teacher')}
              >
                Teacher
              </button>
            </div>
          ))}
      </div>

      {!minimized && !linkedSync && mode === 'manual' && (
        <div className="combobox" ref={comboboxRef}>
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            className="combobox-input"
            placeholder={hasData ? 'Search course name' : 'No courses available'}
            value={query}
            disabled={!hasData}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              // The mobile keyboard's "Search" action key (from
              // enterKeyHint="search" below) sends Enter — dismiss the
              // keyboard while leaving the results panel open (blur doesn't
              // trigger the outside-pointerdown listener that closes it).
              if (e.key === 'Enter') e.target.blur();
            }}
            role="combobox"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label="Search courses"
            autoComplete="off"
            spellCheck="false"
          />
          <SearchAction
            query={query}
            onClear={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          />

          {open && hasData && (
            <div className="combobox-panel" id={panelId} role="group" aria-label="Matching courses">
              <div className="combobox-meta">
                {filtered.length > MAX_VISIBLE_RESULTS
                  ? `Showing ${MAX_VISIBLE_RESULTS} of ${filtered.length} — keep typing to narrow`
                  : filtered.length === allClasses.length
                    ? `${allClasses.length} courses`
                    : `${filtered.length} of ${allClasses.length} courses`}
              </div>
              <div className="combobox-list">
                {filtered.length === 0 ? (
                  <div className="combobox-empty">No courses match “{query}”.</div>
                ) : (
                  filtered.slice(0, MAX_VISIBLE_RESULTS).map((value) => (
                    <CourseOptionRow
                      key={value}
                      value={value}
                      checked={selectedClasses.includes(value)}
                      onToggle={handleToggleClass}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!minimized && !linkedSync && mode === 'rollno' && !hasRollData && (
        <p className="selector-hint">
          Roll-number selection isn’t available yet — check back once this data source is
          connected.
        </p>
      )}

      {!minimized &&
        !linkedSync &&
        (mode === 'rollno' || mode === 'teacher' || mode === 'section') &&
        (mode !== 'rollno' || hasRollData) && (
        <div className="combobox" ref={comboboxRef}>
          <input
            ref={groupInputRef}
            type="search"
            enterKeyHint="search"
            className="combobox-input"
            placeholder={groupPlaceholder}
            value={groupQuery}
            disabled={!hasData}
            onChange={(e) => {
              setGroupQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur();
            }}
            role="combobox"
            aria-expanded={open}
            aria-controls={groupPanelId}
            aria-label={groupAriaLabel}
            autoComplete="off"
            spellCheck="false"
          />
          <SearchAction
            query={groupQuery}
            onClear={() => {
              setGroupQuery('');
              groupInputRef.current?.focus();
            }}
          />

          {open && hasData && (
            <div
              className="combobox-panel"
              id={groupPanelId}
              role="group"
              aria-label={groupAriaLabel}
            >
              <div className="combobox-meta">
                {filteredGroups.length > MAX_VISIBLE_RESULTS
                  ? `Showing ${MAX_VISIBLE_RESULTS} of ${filteredGroups.length} — keep typing to narrow`
                  : filteredGroups.length === groups.length
                    ? `${groups.length} ${groupUnitLabel}`
                    : `${filteredGroups.length} of ${groups.length} ${groupUnitLabel}`}
              </div>
              <div className="combobox-list">
                {filteredGroups.length === 0 ? (
                  <div className="combobox-empty">
                    No {groupUnitLabel} match “{groupQuery}”.
                  </div>
                ) : (
                  filteredGroups.slice(0, MAX_VISIBLE_RESULTS).map((group) =>
                    mode === 'teacher' ? (
                      <GroupOptionRow
                        key={group.name}
                        name={group.name}
                        count={group.classes.length}
                        checked={isGroupSelected(group.classes)}
                        onToggle={handleToggleGroup}
                      />
                    ) : (
                      <SyncOptionRow
                        key={group.name}
                        name={group.name}
                        count={group.classes.length}
                        active={linkedSync?.type === mode && linkedSync.value === group.name}
                        onSelect={handleSyncSelect}
                      />
                    )
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!minimized &&
        (selectedClasses.length > 0 ? (
          <div className="chip-toggle-wrap">
            <div className="reschedule-header">
              <button
                type="button"
                className="link-button reschedule-toggle"
                onClick={() => setShowChips((v) => !v)}
                aria-expanded={showChips}
              >
                Selected classes ({selectedClasses.length})
                <IconChevronDown size={13} className={showChips ? 'is-flipped' : undefined} />
              </button>

              <div className="reschedule-info-wrap" ref={chipsInfoRef}>
                <button
                  type="button"
                  className="info-btn"
                  onClick={() => setShowChipsInfo((v) => !v)}
                  aria-expanded={showChipsInfo}
                  aria-label="What is this list?"
                >
                  <IconInfo size={18} />
                  <span>Info</span>
                </button>
                {showChipsInfo && (
                  <div className="info-popover" role="tooltip">
                    Every class currently on your timetable. Tap the arrow to show or hide the
                    list, and use the × on a class to remove it.
                  </div>
                )}
              </div>
            </div>
            {showChips && (
              <ul className="chip-row" aria-label="Selected sections">
                {selectedClasses.map((value) => {
                  const { course } = splitClassValue(value);
                  return (
                    <li key={value} className="chip" title={formatClassLabel(value)}>
                      <span
                        className="chip-dot"
                        style={{ backgroundColor: courseColors[course] || 'var(--text-3)' }}
                      />
                      <span className="chip-label">{formatClassLabel(value)}</span>
                      <button
                        type="button"
                        className="chip-remove"
                        aria-label={`Remove ${formatClassLabel(value)}`}
                        onClick={() => removeClass(value)}
                      >
                        <IconX size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <p className="selector-hint">
            Pick the sections you’re enrolled in — your timetable builds itself below and stays
            saved on this device.
          </p>
        ))}

      {!minimized && occurrences.length > 0 && (
        <div className="reschedule-section">
          <div className="reschedule-header">
            <button
              type="button"
              className="link-button reschedule-toggle"
              onClick={() => setShowReschedule((v) => !v)}
              aria-expanded={showReschedule}
            >
              Adjust class times
              <IconChevronDown size={13} className={showReschedule ? 'is-flipped' : undefined} />
            </button>

            <div className="reschedule-info-wrap" ref={rescheduleInfoRef}>
              <button
                type="button"
                className="info-btn"
                onClick={() => setShowRescheduleInfo((v) => !v)}
                aria-expanded={showRescheduleInfo}
                aria-label="What does adjusting class times do?"
              >
                <IconInfo size={18} />
                <span>Info</span>
              </button>
              {showRescheduleInfo && (
                <div className="info-popover" role="tooltip">
                  Moved by the university but the official sheet hasn’t caught up yet? Set a
                  different day/time here — it only changes what you see, not the shared
                  schedule.
                </div>
              )}
            </div>
          </div>

          {showReschedule && (
            <div className="reschedule-panel">
              {moveError && (
                <p className="reschedule-error" role="alert">
                  {moveError}
                </p>
              )}
              <div className="reschedule-list">
                {occurrences.map((occurrence) => {
                  const activeOverride = findActiveOverride(occurrence);
                  return (
                    <RescheduleRow
                      key={`${occurrence.course}|${occurrence.section}|${occurrence.day}|${occurrence.slots[0]}`}
                      occurrence={occurrence}
                      timeSlots={timeSlots}
                      activeOverride={activeOverride}
                      roomOptions={roomOptions}
                      onMove={(newDay, newSlot, newRoom) => handleMove(occurrence, newDay, newSlot, newRoom)}
                      onReset={() => handleResetMove(occurrence)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!minimized && selectedClasses.length > 0 && (
        <div className="reschedule-section">
          <div className="reschedule-header">
            <button
              type="button"
              className="link-button reschedule-toggle"
              onClick={() => setShowExtra((v) => !v)}
              aria-expanded={showExtra}
            >
              Add extra class
              <IconChevronDown size={13} className={showExtra ? 'is-flipped' : undefined} />
            </button>

            <div className="reschedule-info-wrap" ref={extraInfoRef}>
              <button
                type="button"
                className="info-btn"
                onClick={() => setShowExtraInfo((v) => !v)}
                aria-expanded={showExtraInfo}
                aria-label="What does adding an extra class do?"
              >
                <IconInfo size={18} />
                <span>Info</span>
              </button>
              {showExtraInfo && (
                <div className="info-popover" role="tooltip">
                  For a one-off makeup or revision class. Pick one of your already-selected
                  courses and a day/slot — it won’t appear on print or downloaded images, and
                  removes itself once the class time has passed.
                </div>
              )}
            </div>
          </div>

          {showExtra && (
            <div className="reschedule-panel">
              {extraError && (
                <p className="reschedule-error" role="alert">
                  {extraError}
                </p>
              )}
              <div className="reschedule-edit-panel">
                <CourseCombobox
                  options={selectedClasses}
                  value={effectiveExtraCourse}
                  onChange={setExtraCourseValue}
                />
                <div className="reschedule-field-row">
                  <select
                    className="reschedule-select"
                    value={extraDay}
                    onChange={(e) => setExtraDay(e.target.value)}
                    aria-label="Day for the extra class"
                  >
                    {DAY_ORDER.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    className="reschedule-select"
                    value={effectiveExtraSlot}
                    onChange={(e) => setExtraSlot(e.target.value)}
                    aria-label="Time slot for the extra class"
                  >
                    {timeSlots.map((s, i) => (
                      <option key={s} value={s}>
                        {`Slot ${i + 1} · ${formatSlot(s).start}`}
                      </option>
                    ))}
                  </select>
                </div>
                {showExtraRoomPicker ? (
                  <>
                    <RoomFields
                      roomOptions={roomOptions}
                      sel={effectiveExtraRoomSel}
                      onBuildingChange={(building) => setExtraRoomSel({ building })}
                      onTypeChange={(type) => setExtraRoomSel({ building: effectiveExtraRoomSel.building, type })}
                      onLetterChange={(letter) =>
                        setExtraRoomSel({ building: effectiveExtraRoomSel.building, type: effectiveExtraRoomSel.type, letter })
                      }
                      onNumberChange={(number) => setExtraRoomSel({ ...effectiveExtraRoomSel, number })}
                      onLabRoomChange={(labRoom) => setExtraRoomSel({ ...effectiveExtraRoomSel, labRoom })}
                    />
                    <div className="reschedule-edit-actions">
                      <button type="button" className="action-btn-blue" onClick={handleAddExtra}>
                        Add
                      </button>
                      <button type="button" className="action-btn-blue" onClick={() => setShowExtraRoomPicker(false)}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="reschedule-edit-actions">
                    <button type="button" className="action-btn-blue" onClick={handleAddExtra}>
                      Add
                    </button>
                    <button type="button" className="action-btn-blue" onClick={() => setShowExtraRoomPicker(true)}>
                      Change room
                    </button>
                  </div>
                )}
              </div>

              {extraClasses.length > 0 && (
                <div className="reschedule-list">
                  {extraClasses.map((extra) => (
                    <div
                      key={`${extra.course}|${extra.section}|${extra.day}|${extra.time}`}
                      className="reschedule-row"
                    >
                      <div className="reschedule-info">
                        <span className="reschedule-course">
                          {extra.course}
                          {extra.section !== 'N/A' && ` (${extra.section})`}
                        </span>
                        <span className="reschedule-official">
                          {extra.day}, {formatSlot(extra.time).start}
                          {extra.room && ` · ${cleanRoom(extra.room)}`}
                        </span>
                      </div>
                      <div className="reschedule-controls">
                        <button type="button" className="link-button" onClick={() => handleRemoveExtra(extra)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </section>
    </>
  );
};

export default ClassSelector;
