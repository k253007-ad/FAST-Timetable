import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { splitClassValue, formatClassLabel, getActivityColor, withAlpha } from '../utils/courseColors.js';
import {
  ACTIVITY_TYPES,
  buildMoveOverrides,
  cleanRoom,
  DAY_ORDER,
  formatSlot,
  getAllTimeSlots,
  getClassOccurrences,
  getOccupiedSlots,
  getRoomOptions,
  locateRoom,
  resolveRoomSelection,
} from '../utils/schedule.js';
import { IconChevronDown, IconPin, IconSearch, IconX } from './Icons.jsx';

// Custom activity names a student has typed in "Manage activities" — saved
// so they show up in the type dropdown from then on instead of needing to be
// retyped every time, until explicitly removed (2026-09-07). Device-wide,
// not per-profile: it's a personal vocabulary of activity names, not part of
// any one profile's schedule, so it's read/written directly here rather than
// threaded through App.jsx's per-profile storage like `activities` itself.
const CUSTOM_ACTIVITY_KEY = 'customActivityTypes';

// Roll No search "ghost" fill (2026-09-10, on request) — the currently
// enrolled intake years, hardcoded rather than derived from the live sheet
// on purpose: the sheet can still carry older/graduated intakes (e.g. a
// stray "20K-...") that shouldn't be offered as a searchable roll number
// any more, so this is a deliberate allowlist, not "whatever prefixes
// happen to appear in the data today." Update this list when a new intake
// year starts (or an old one should stop being offered).
const ROLL_NO_PREFIXES = ['21K', '22K', '23K', '24K', '25K', '26K'];
const ROLL_NO_MAX = 9999;

const getSavedCustomActivityNames = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITY_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const saveCustomActivityNames = (names) => {
  try {
    localStorage.setItem(CUSTOM_ACTIVITY_KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable */
  }
};

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

// Generic "tap a trigger, a panel of option rows drops down below it" shell
// — shared by CourseDropdown (single-select, closes on pick) and the
// "Manage activities" time-slot picker (multi-select checkboxes, stays open
// across picks) below, so the open/close/outside-dismiss wiring isn't
// duplicated between them. Not a search box — no filtering, just a plain
// dropdown list, same visual language (`.combobox`/`.combobox-panel`/
// `.option-row`) as the rest of this app's pickers.
const DropdownShell = ({ label, open, onToggle, onClose, ariaLabel, children }) => {
  const wrapRef = useRef(null);
  useDismissOnOutside(open, onClose, wrapRef);
  return (
    <div className="combobox" ref={wrapRef}>
      <button
        type="button"
        className="combobox-input combobox-trigger"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="combobox-trigger-label">{label}</span>
      </button>
      <span className="combobox-action" aria-hidden="true">
        <IconChevronDown size={15} className={open ? 'is-flipped' : undefined} />
      </span>
      {open && (
        <div className="combobox-panel" role="group" aria-label={ariaLabel}>
          <div className="combobox-list">{children}</div>
        </div>
      )}
    </div>
  );
};

// Single-select course picker for "Add extra class" — a plain dropdown list
// (no search box: reverted 2026-09-07 after feedback that a search input
// wasn't wanted here) of the student's own selected courses, wrapping long
// names inside `.option-course` like every other list in this app instead
// of a native <select>'s trigger text, which was overflowing on narrow
// phone screens for long course names.
const CourseDropdown = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <DropdownShell
      label={value ? formatClassLabel(value) : 'Select a course'}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      onClose={() => setOpen(false)}
      ariaLabel="Course for the extra class"
    >
      {options.map((v) => (
        <button
          key={v}
          type="button"
          className={`option-row option-row-sync${v === value ? ' is-checked' : ''}`}
          onClick={() => {
            onChange(v);
            setOpen(false);
          }}
        >
          <span className="option-text">
            <span className="option-course">{formatClassLabel(v)}</span>
          </span>
        </button>
      ))}
    </DropdownShell>
  );
};

// "Manage activities"' Type field — built on the same DropdownShell as
// CourseDropdown above, rather than a native <select>, specifically so a
// saved custom name's own row can carry an inline .chip-remove X (2026-09-09,
// on request: "there should be cross right of custom activities" — replaces
// the earlier separate "Remove from list" text link, which only ever acted
// on whichever custom name happened to be currently selected). Built-in
// types and "Custom…" are plain select-and-close buttons, same as
// CourseDropdown's rows; a saved custom name's row can't itself be a
// <button> (it nests the remove button — a <button> can't contain another
// <button>, same reasoning as the assigned-activity-slot row below), so it's
// a click/keyboard-activatable <div> instead, with the X calling
// `stopPropagation` so removing a name never also selects it.
const ActivityTypeDropdown = ({ builtIns, customTypes, activityType, isCustomActivity, onSelect, onSelectCustom, onRemoveCustom }) => {
  const [open, setOpen] = useState(false);
  const label = isCustomActivity ? 'Custom…' : activityType;
  const isChecked = (t) => !isCustomActivity && activityType === t;

  return (
    <DropdownShell
      label={label}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      onClose={() => setOpen(false)}
      ariaLabel="Activity type"
    >
      {builtIns.map((t) => (
        <button
          key={t}
          type="button"
          className={`option-row option-row-sync${isChecked(t) ? ' is-checked' : ''}`}
          onClick={() => {
            onSelect(t);
            setOpen(false);
          }}
        >
          <span className="option-text">
            <span className="option-course">{t}</span>
          </span>
        </button>
      ))}
      {customTypes.map((t) => (
        <div
          key={t}
          className={`option-row option-row-sync${isChecked(t) ? ' is-checked' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => {
            onSelect(t);
            setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(t);
              setOpen(false);
            }
          }}
        >
          <span className="option-text">
            <span className="option-course">{t}</span>
          </span>
          <button
            type="button"
            className="chip-remove"
            aria-label={`Remove "${t}" from the activity dropdown`}
            onClick={(e) => {
              e.stopPropagation();
              onRemoveCustom(t);
            }}
          >
            <IconX size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={`option-row option-row-sync${isCustomActivity ? ' is-checked' : ''}`}
        onClick={() => {
          onSelectCustom();
          setOpen(false);
        }}
      >
        <span className="option-text">
          <span className="option-course">Custom…</span>
        </span>
      </button>
    </DropdownShell>
  );
};

// The 4 "My classes" sections (Selected courses / Adjust class times / Add
// extra class / Manage activities) each open their content as a modal
// dialog rather than expanding inline (2026-09-07, on request) — this is
// the shared overlay/box every one of them renders through, portaled to
// `document.body` so its fixed positioning is never trapped by an ancestor
// with its own transform/overflow (the exact failure mode a plain
// `position: fixed` div nested deep in the card could otherwise hit).
// Replaces the separate per-section (i) Info popovers, which were dropped
// as part of the same request.
export const Modal = ({ title, onBack, onClose, children }) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const titleId = useId();

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div className="modal-header-title">
            {onBack && (
              <button type="button" className="modal-back" onClick={onBack} aria-label="Back">
                <IconChevronDown size={16} />
              </button>
            )}
            <h3 className="modal-title" id={titleId}>
              {title}
            </h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
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
//
// `isGhost` (2026-09-10, Roll No only, see ROLL_NO_PREFIXES above): a
// roll number in the allowed intake range that has no real course data.
// A real, clickable row exactly like any other (on request: "make the roll
// display same as other, only no data found should be different") —
// clicking one syncs like any other pick (see `handleSyncSelect`) and also
// surfaces the "no data" message, nudging the student to search courses
// manually instead. The class-count text is the only visual difference.
const SyncOptionRow = memo(({ name, count, active, isGhost, onSelect }) => (
  <button
    type="button"
    value={name}
    className={`option-row option-row-sync${active ? ' is-checked' : ''}`}
    onClick={onSelect}
  >
    <span className="option-text">
      <span className="option-course">{name}</span>
      <span className="option-section">
        {isGhost ? 'No data found' : `${count} class${count === 1 ? '' : 'es'}`}
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

// A read-only row in the "Adjust class times" courses step (2026-09-07: the
// modal is now a Day -> Courses -> Edit wizard, not one long list with
// inline-expanding edit panels) — course info, its official time/room, an
// active override's "moved to" info if any, and Edit/Reset. Clicking Edit
// hands the occurrence up to the modal, which switches to the edit step
// (RescheduleEditScreen below) rather than expanding anything inline.
const RescheduleSummaryRow = ({ occurrence, activeOverride, onEditClick, onReset }) => {
  const officialStart = formatSlot(occurrence.slots[0]).start;
  const officialEnd = formatSlot(occurrence.slots[occurrence.slots.length - 1]).end;
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
      <div className="reschedule-controls">
        <button type="button" className="action-btn-blue" onClick={onEditClick}>
          Edit
        </button>
        {activeOverride && (
          <button type="button" className="action-btn" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
};

// The "Adjust class times" wizard's edit step — its own full screen (see
// the modal's onBack-driven header above), not an inline panel. Day/Slot
// are native <select>s (2026-09-07: "dont remove days and slots dropdown"
// — a same-day reversal of a brief PillOptions experiment); Room is always
// shown as RoomFields, no "Change room" toggle, since `effectiveRoomSel`
// already defaults correctly to the occurrence's own current room whether
// or not the student ever touches it. Its own local `day`/`slot`/`roomSel`
// state is the *pending* pick — nothing happens until Move/Update is
// clicked. `onMove` returns whether it succeeded (a move can fail — not
// enough slots left in the target day — in which case this screen stays
// open with the error shown instead of navigating back).
const RescheduleEditScreen = ({ occurrence, timeSlots, activeOverride, roomOptions, moveError, onMove, onReset }) => {
  const [day, setDay] = useState(activeOverride ? activeOverride.newDay : occurrence.day);
  const [slot, setSlot] = useState(activeOverride ? activeOverride.newTime : occurrence.slots[0]);
  const [roomSel, setRoomSel] = useState(
    () => locateRoom(roomOptions, activeOverride?.newRoom || occurrence.room) || {}
  );
  const effectiveRoomSel = resolveRoomSelection(roomOptions, roomSel);

  const officialStart = formatSlot(occurrence.slots[0]).start;
  const officialEnd = formatSlot(occurrence.slots[occurrence.slots.length - 1]).end;

  return (
    <div className="reschedule-edit-panel">
      <div className="reschedule-edit-summary">
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
      {moveError && (
        <p className="reschedule-error" role="alert">
          {moveError}
        </p>
      )}
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
      <div className="reschedule-edit-actions">
        <button
          type="button"
          className="action-btn-blue"
          onClick={() => onMove(day, slot, effectiveRoomSel.resolvedRoom)}
        >
          {activeOverride ? 'Update' : 'Move'}
        </button>
        {activeOverride && (
          <button type="button" className="link-button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Searchable multi-select for course sections, with the current selection
 * shown as removable chips. Stored values keep the legacy
 * "Course - Section" format so existing saved selections keep working.
 *
 * Three group-selection modes, plus a separate "Search courses" popup for
 * individual picks (replaced the old Manual/Auto 2-tab layout on 2026-08-25
 * — "Auto" used to nest Student-section/Teacher under one tab; Section was
 * dropped entirely at first in favor of the more precise Roll No pick, then
 * added back as its own tab on 2026-08-26 since some students just want
 * "everything BCS-3A takes" rather than one specific student):
 *  - Roll No: pick a specific student's roll number (e.g. "3068") — see
 *    "Keep synced" below, this is no longer a plain group toggle.
 *  - Section: pick a section/cohort code (e.g. "BCS-3A") — same "keep
 *    synced" behavior as Roll No.
 *  - Teacher: pick a teacher name and every class they teach is added/
 *    removed as a group — built from `data.timetable`, the one group mode
 *    that stayed a plain toggle (never in scope for "keep synced"). (Tab
 *    order: Roll No, Section, Teacher.)
 *  - **Course search (2026-09-10, moved out of the mode-tabs entirely,
 *    on request)** — used to be a 4th tab ("Course", `mode` internally still
 *    `'manual'` from its original "Manual" name) with an always-inline
 *    search box; it's now its own popup (`showCourseSearch`), reachable
 *    only via the "Add courses" button inside the "Selected courses" modal
 *    (`openCourseSearch`) — picking individual course sections one at a
 *    time, unaffected by "keep synced" except that opening this popup
 *    cancels an active sync (see `openCourseSearch`'s own comment).
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
  activities,
  setActivities,
  courseColors,
  activeProfile,
  profileCount,
  onSwitchProfile,
  linkedSync,
  setLinkedSync,
}) => {
  const [mode, setMode] = useState('rollno'); // 'rollno' | 'teacher' | 'section' — see the doc comment above re: 'manual'
  const [query, setQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState(''); // shared search box for roll no / teacher / section tabs
  // "One-time" (2026-09-10): shown once when a ghost roll number is picked,
  // cleared on the next search/mode change/successful sync rather than
  // persisting indefinitely — see `handleSyncSelect`/`switchMode`.
  const [noDataMessage, setNoDataMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [showChips, setShowChips] = useState(false);
  // "Search courses" popup (2026-09-10, on request: "remove the search
  // course from the options and make it popup, which can be accessed from
  // the button in selected courses") — Course used to be a 4th mode tab
  // alongside Roll No/Section/Teacher with its own always-inline search box;
  // it's now reachable only via "Add courses" inside the "Selected courses"
  // modal (openCourseSearch below), never from the mode-tabs row.
  const [showCourseSearch, setShowCourseSearch] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  // A 3-step wizard inside the "Adjust class times" modal (2026-09-07):
  // `rescheduleDay === null` shows only the 5 day buttons; picking a day
  // shows only that day's courses; picking Edit on one of those shows only
  // its edit form (`editingOccurrence`). Both reset to null whenever the
  // modal closes (see closeReschedule below), so it always reopens at the
  // day-picker step rather than wherever it was left.
  const [rescheduleDay, setRescheduleDay] = useState(null);
  const [editingOccurrence, setEditingOccurrence] = useState(null);
  const [moveError, setMoveError] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [extraCourseValue, setExtraCourseValue] = useState('');
  const [extraDay, setExtraDay] = useState(DAY_ORDER[0]);
  const [extraSlot, setExtraSlot] = useState('');
  const [extraError, setExtraError] = useState('');
  const [showSyncInfo, setShowSyncInfo] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [activityType, setActivityType] = useState(ACTIVITY_TYPES[0]);
  const [isCustomActivity, setIsCustomActivity] = useState(false);
  const [customActivityName, setCustomActivityName] = useState('');
  const [customActivityNames, setCustomActivityNames] = useState(getSavedCustomActivityNames);
  const [activityDay, setActivityDay] = useState(DAY_ORDER[0]);
  const [activityError, setActivityError] = useState('');
  const comboboxRef = useRef(null);
  const inputRef = useRef(null);
  const groupInputRef = useRef(null);
  const syncBadgeRef = useRef(null);
  const panelId = useId();
  const groupPanelId = useId();

  useDismissOnOutside(showSyncInfo, () => setShowSyncInfo(false), syncBadgeRef);

  // Close on outside click / Escape while the group (Roll No/Section/
  // Teacher) dropdown is open. "Outside" means outside the search box +
  // its panel — not just outside the whole card — so clicking elsewhere in
  // "My classes" (title, tabs, chips) closes it too. `mode` is always one
  // of those three whenever `open` applies here — the Course search box
  // moved into its own modal (2026-09-10, see `showCourseSearch` above)
  // with no open/closed panel state of its own to manage.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Refocus first: the input's onFocus sets open=true, and the
        // close below must win when React batches the two updates.
        groupInputRef.current?.focus();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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

  // Returns whether the move succeeded, so the edit screen knows whether to
  // navigate back to the courses list (success) or stay put showing the
  // error (failure — not enough slots left in the target day).
  const handleMove = (occurrence, newDay, newStartSlot, newRoom) => {
    const entries = buildMoveOverrides(occurrence, timeSlots, newDay, newStartSlot, newRoom);
    if (!entries) {
      setMoveError(`Not enough time slots left in ${newDay} to fit this class.`);
      return false;
    }
    setMoveError('');
    setOverrides((prev) => [...prev.filter((o) => !belongsToOccurrence(o, occurrence)), ...entries]);
    return true;
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
  // Always shown, no "Change room" toggle (removed 2026-09-07, matching the
  // same change already made to "Adjust class times") — most extra classes
  // happen in the same room as usual, so the always-on default
  // (`effectiveExtraRoomSel` resolving to the course's real room) is
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

  // "Manage activities" — personal, non-course blocks (Library, Prayer/
  // Namaz, or a free-typed custom one) that behave like a class everywhere
  // else (grid, Now/Next, notifications) but never displace a real one:
  // App.jsx auto-removes an activity the moment a course ends up in its
  // slot, so there's no duplicate-clash check needed here beyond "not the
  // same activity twice".

  // Only offer slots the student is actually free for on the chosen day —
  // `getOccupiedSlots` is the same "does a real course sit here" check
  // App.jsx's own auto-removal effect uses, so a slot that disappears from
  // this list is exactly one that would auto-remove the activity anyway.
  const occupiedSlots = useMemo(
    () => getOccupiedSlots(data, selectedClasses, overrides),
    [data, selectedClasses, overrides]
  );
  const freeSlotsForDay = useMemo(
    () => timeSlots.filter((s) => !occupiedSlots.has(`${activityDay}|${s}`)),
    [timeSlots, occupiedSlots, activityDay]
  );

  const effectiveActivityType = isCustomActivity ? customActivityName.trim() : activityType;

  // Tapping a slot adds/removes the activity immediately — no separate
  // "Add" step. Whether a slot already has an activity is checked against
  // *any* type at that day+time, not just the currently-selected type
  // (2026-09-07: "when i switch to cafe the library on slots must remain"
  // — switching the Type dropdown must never make an already-assigned
  // slot's own display revert to looking unassigned just because it
  // doesn't match whatever's newly selected). Tapping an already-assigned
  // slot removes *that* slot's actual activity, regardless of the
  // currently-selected type; tapping a genuinely empty slot assigns the
  // currently-selected type to it.
  const toggleActivitySlot = (slot) => {
    const existing = activities.find((a) => a.day === activityDay && a.time === slot);
    if (existing) {
      setActivities((prev) => prev.filter((a) => a !== existing));
      return;
    }

    const effectiveType = effectiveActivityType;
    if (!effectiveType) {
      setActivityError('Enter a name for the custom activity.');
      return;
    }
    setActivityError('');
    setActivities((prev) => [...prev, { type: effectiveType, day: activityDay, time: slot }]);

    // Save a genuinely new custom name into the persisted dropdown list, and
    // switch the picker straight to it (not back to "Custom…") so checking
    // more slots for the same activity works without retyping — see
    // CUSTOM_ACTIVITY_KEY above.
    if (isCustomActivity) {
      if (!ACTIVITY_TYPES.includes(effectiveType) && !customActivityNames.includes(effectiveType)) {
        const next = [...customActivityNames, effectiveType];
        setCustomActivityNames(next);
        saveCustomActivityNames(next);
      }
      setIsCustomActivity(false);
      setActivityType(effectiveType);
      setCustomActivityName('');
    }
  };

  // Removes a saved custom name from the type dropdown only — any
  // activities already scheduled with that name keep working exactly as
  // before, this just stops offering it as an option for new ones.
  const handleRemoveCustomType = (name) => {
    const next = customActivityNames.filter((n) => n !== name);
    setCustomActivityNames(next);
    saveCustomActivityNames(next);
    if (!isCustomActivity && activityType === name) setActivityType(ACTIVITY_TYPES[0]);
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

  // Ghost-fills Roll No mode's list (2026-09-10, on request) — every roll
  // number in the allowed intake range (ROLL_NO_PREFIXES x 0001-9999) is a
  // real, listed row: a roll number with real data uses its real entry, one
  // without becomes a `{ classes: [], isGhost: true }` placeholder so
  // searching a specific roll number always surfaces *something* ("No data
  // found") instead of a bare "no roll numbers match" — the student can
  // tell "this number doesn't exist for me" apart from "the search itself
  // is broken." Built by walking the allowed range in order (rather than
  // generating ghosts separately and sorting the combined list afterward),
  // so the result comes out already sorted by roll number for free.
  // Computed once per `rollNoGroups`/`mode` — deliberately NOT re-derived
  // per keystroke (`groups` below decides *whether* to use it, so typing
  // never regenerates this ~60,000-row array, only re-filters over
  // whichever of it/the real list is already sitting in memory).
  const rollNoUniverse = useMemo(() => {
    if (mode !== 'rollno') return rollNoGroups;
    const realByName = new Map(rollNoGroups.map((g) => [g.name, g]));
    const combined = [];
    for (const prefix of ROLL_NO_PREFIXES) {
      for (let n = 1; n <= ROLL_NO_MAX; n++) {
        const name = `${prefix}-${String(n).padStart(4, '0')}`;
        combined.push(realByName.get(name) || { name, classes: [], isGhost: true });
      }
    }
    return combined;
  }, [rollNoGroups, mode]);

  // Real roll numbers only until the student's typed at least 2 characters
  // (2026-09-10, on request: "show only roll no with available classes
  // first, when user types 2 or more characters then show the ghost
  // ones") — an untyped/1-character query would match thousands of ghosts
  // at once (not useful, and the default un-searched view should lead with
  // what actually exists), so ghosts only enter the pool once the query is
  // specific enough to be worth padding out with "doesn't exist" rows.
  const groups = useMemo(() => {
    if (mode === 'rollno') {
      return groupQuery.trim().length >= 2 ? rollNoUniverse : rollNoGroups;
    }
    if (mode === 'teacher') return instructorGroups;
    if (mode === 'section') return sectionGroups;
    return [];
  }, [mode, rollNoUniverse, rollNoGroups, instructorGroups, sectionGroups, groupQuery]);

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
  //
  // A ghost roll number (2026-09-10, see `rollNoUniverse` above) still
  // syncs like any other pick (on request: "when clicked on ghost ones it
  // should sync") — `getClassesForRollNo` returning `[]` for a roll number
  // that genuinely has no data is already a valid, handled state (see the
  // "Keep synced" doc comment in App.jsx). It additionally surfaces a
  // one-time message nudging the student toward manually searching courses
  // (the "Search courses" popup) instead, since syncing them to an empty
  // selection with no explanation would look like the app just did nothing.
  // Checked against `rollNoGroups` (the real-only set), not `rollNoUniverse`
  // (which also holds every ghost) — cheaper membership test, same result.
  const realRollNoNames = useMemo(() => new Set(rollNoGroups.map((g) => g.name)), [rollNoGroups]);

  const handleSyncSelect = useCallback(
    (e) => {
      const value = e.currentTarget.value;
      setNoDataMessage(
        mode === 'rollno' && !realRollNoNames.has(value)
          ? 'Your Courses data is not Present, Please Select Your Courses'
          : ''
      );
      setLinkedSync({ type: mode, value });
    },
    [mode, realRollNoNames, setLinkedSync]
  );

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setGroupQuery('');
    setNoDataMessage('');
    setOpen(false);
  };

  const toggleMinimized = () => {
    setOpen(false);
    setMinimized((v) => !v);
  };

  // "Add courses" (2026-09-10, on request: a button in "Selected courses"
  // that "goes to search courses popup") — opens the "Search courses"
  // modal (`showCourseSearch`; Course is no longer a mode tab at all as of
  // the same day's follow-up request — see that state's own doc comment).
  // **Does NOT cancel an active "keep synced" link** (reversed same day,
  // on request: "Add courses should not De-Sync the roll-no... added
  // courses should be synced to roll no and removed courses should be
  // removed") — an earlier version cancelled sync here, back when syncing
  // meant a destructive full-replace on every resolve that would've
  // silently wiped out anything manually added. Now that App.jsx's "Keep
  // synced" effect only applies the *diff* of what the university's data
  // actually changed (not a full replace) on every subsequent resolve, a
  // manually added or removed course while synced survives future
  // resyncs — see that effect's own doc comment for the full design.
  // Focusing the input has to wait for the *next* render — the modal (and
  // its input) doesn't exist in the DOM yet at the moment this handler
  // runs — so a token bump drives a dedicated effect instead of calling
  // `.focus()` inline.
  const [focusSearchToken, setFocusSearchToken] = useState(0);
  useEffect(() => {
    if (focusSearchToken === 0) return;
    inputRef.current?.focus();
  }, [focusSearchToken]);

  const openCourseSearch = () => {
    setShowChips(false);
    setQuery('');
    setShowCourseSearch(true);
    setFocusSearchToken((t) => t + 1);
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

        {linkedSync ? (
          // Deliberately NOT gated by `!minimized` (2026-09-07, on request)
          // — a sync being active is important status the student should
          // always see, even with "My classes" collapsed down to just the
          // minimize toggle.
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
        ) : null}

        {/* Rendered unconditionally (not nested inside the `!linkedSync`
            branch below) — picking a ghost roll number now syncs (see
            handleSyncSelect above), which immediately swaps the search box
            out for the green sync indicator above; a message living inside
            that now-unmounted search box would vanish the instant it
            appeared, so it has to sit outside both branches to survive the
            sync happening in the same click. */}
        {noDataMessage && (
          <p className="reschedule-error" role="alert">
            {noDataMessage}
          </p>
        )}

        {!linkedSync && !minimized && (
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
        )}
      </div>

      {showCourseSearch && (
        <Modal title="Search courses" onClose={() => setShowCourseSearch(false)}>
          <div className="combobox">
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              className="combobox-input"
              placeholder={hasData ? 'Search course name' : 'No courses available'}
              value={query}
              disabled={!hasData}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // The mobile keyboard's "Search" action key (from
                // enterKeyHint="search" below) sends Enter — dismiss the
                // keyboard, the results list stays visible regardless
                // (it's always shown inside this modal, no open/closed
                // state to lose).
                if (e.key === 'Enter') e.target.blur();
              }}
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
          </div>

          {hasData && (
            <div id={panelId} role="group" aria-label="Matching courses">
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
        </Modal>
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
              setNoDataMessage('');
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
                        isGhost={group.isGhost}
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

      {/* The 4 "My classes" sections open as modals now, not inline-expanding
          panels (2026-09-07, on request) — see Modal above. Always all 4
          buttons, disabled with a title tooltip rather than hidden when
          there's nothing to act on yet, so the row never jumps around. */}
      {!minimized && (
        <div className="section-btn-row">
          <button type="button" className="section-btn" onClick={() => setShowChips(true)}>
            <span>Select courses</span>
            {selectedClasses.length > 0 && <span className="section-btn-count">{selectedClasses.length}</span>}
          </button>

          <button
            type="button"
            className="section-btn"
            onClick={() => setShowReschedule(true)}
            disabled={occurrences.length === 0}
            title={occurrences.length === 0 ? 'Select classes first' : undefined}
          >
            <span>Adjust class times</span>
          </button>

          <button
            type="button"
            className="section-btn"
            onClick={() => setShowExtra(true)}
            disabled={selectedClasses.length === 0}
            title={selectedClasses.length === 0 ? 'Select classes first' : undefined}
          >
            <span>Add extra class</span>
            {extraClasses.length > 0 && <span className="section-btn-count">{extraClasses.length}</span>}
          </button>

          <button type="button" className="section-btn" onClick={() => setShowActivities(true)}>
            <span>Manage activities</span>
            {activities.length > 0 && <span className="section-btn-count">{activities.length}</span>}
          </button>
        </div>
      )}

      {showChips && (
        <Modal title="Select courses" onClose={() => setShowChips(false)}>
          <button type="button" className="action-btn-blue selector-add-courses-btn" onClick={openCourseSearch}>
            Add courses
          </button>
          {selectedClasses.length > 0 ? (
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
          ) : (
            <p className="selector-hint">
              Pick the sections you’re enrolled in — your timetable builds itself below and stays
              saved on this device.
            </p>
          )}
        </Modal>
      )}

      {showReschedule &&
        (() => {
          // Reset the wizard back to step 1 (day picker) on close, so a
          // reopen never lands mid-edit or on a stale day (2026-09-07).
          const closeReschedule = () => {
            setShowReschedule(false);
            setRescheduleDay(null);
            setEditingOccurrence(null);
            setMoveError('');
          };

          if (editingOccurrence) {
            return (
              <Modal
                title={editingOccurrence.course}
                onBack={() => {
                  setEditingOccurrence(null);
                  setMoveError('');
                }}
                onClose={closeReschedule}
              >
                <RescheduleEditScreen
                  occurrence={editingOccurrence}
                  timeSlots={timeSlots}
                  activeOverride={findActiveOverride(editingOccurrence)}
                  roomOptions={roomOptions}
                  moveError={moveError}
                  onMove={(newDay, newSlot, newRoom) => {
                    const ok = handleMove(editingOccurrence, newDay, newSlot, newRoom);
                    if (ok) setEditingOccurrence(null);
                  }}
                  onReset={() => {
                    handleResetMove(editingOccurrence);
                    setEditingOccurrence(null);
                  }}
                />
              </Modal>
            );
          }

          if (rescheduleDay) {
            const dayOccurrences = occurrences.filter((o) => o.day === rescheduleDay);
            return (
              <Modal title={rescheduleDay} onBack={() => setRescheduleDay(null)} onClose={closeReschedule}>
                <div className="reschedule-list">
                  {dayOccurrences.length === 0 ? (
                    <p className="selector-hint">No classes on {rescheduleDay}.</p>
                  ) : (
                    dayOccurrences.map((occurrence) => (
                      <RescheduleSummaryRow
                        key={`${occurrence.course}|${occurrence.section}|${occurrence.day}|${occurrence.slots[0]}`}
                        occurrence={occurrence}
                        activeOverride={findActiveOverride(occurrence)}
                        onEditClick={() => setEditingOccurrence(occurrence)}
                        onReset={() => handleResetMove(occurrence)}
                      />
                    ))
                  )}
                </div>
              </Modal>
            );
          }

          // Step 1: only the 5 day buttons — nothing else on screen, except
          // a top "Reset all" when there's something to reset (2026-09-10,
          // on request) — clears every override across every day at once,
          // same `.selector-head` count-pill + `.link-button` pattern as
          // "Manage activities"' own "Remove all". Lives here rather than
          // per-day (step 2) since an override can be on any day and this
          // is the one screen that's day-agnostic.
          return (
            <Modal title="Adjust class times" onClose={closeReschedule}>
              {overrides.length > 0 && (
                <div className="selector-head">
                  <span className="count-pill">{overrides.length} adjusted</span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setOverrides([])}
                    aria-label="Reset all adjusted class times"
                  >
                    Reset all
                  </button>
                </div>
              )}
              {/* Top-to-bottom, not the Today view's horizontal row
                  (2026-09-07) — .day-picker-vertical is additive so the
                  shared .day-picker/.day-tab classes stay unchanged for
                  Today's own picker. */}
              <div className="day-picker day-picker-vertical" role="tablist" aria-label="Choose a day">
                {DAY_ORDER.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    className="day-tab"
                    onClick={() => setRescheduleDay(d)}
                  >
                    {d}
                    <IconChevronDown size={16} className="day-tab-chevron" />
                  </button>
                ))}
              </div>
            </Modal>
          );
        })()}

      {showExtra && (
        <Modal title="Add extra class" onClose={() => setShowExtra(false)}>
          {extraError && (
            <p className="reschedule-error" role="alert">
              {extraError}
            </p>
          )}
          <div className="reschedule-edit-panel">
            <CourseDropdown
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
            </div>
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
        </Modal>
      )}

      {showActivities && (
        <Modal title="Manage activities" onClose={() => setShowActivities(false)}>
          {activities.length > 0 && (
            <div className="selector-head">
              <span className="count-pill">{activities.length} activities</span>
              <button
                type="button"
                className="link-button"
                onClick={() => setActivities([])}
                aria-label="Remove all activities"
              >
                Remove all
              </button>
            </div>
          )}
          {activityError && (
            <p className="reschedule-error" role="alert">
              {activityError}
            </p>
          )}
          <div className="reschedule-edit-panel">
            <ActivityTypeDropdown
              builtIns={ACTIVITY_TYPES}
              customTypes={customActivityNames}
              activityType={activityType}
              isCustomActivity={isCustomActivity}
              onSelect={(name) => {
                setIsCustomActivity(false);
                setActivityType(name);
              }}
              onSelectCustom={() => setIsCustomActivity(true)}
              onRemoveCustom={handleRemoveCustomType}
            />
            {isCustomActivity && (
              <input
                type="text"
                className="reschedule-select"
                placeholder="Custom activity name"
                value={customActivityName}
                onChange={(e) => setCustomActivityName(e.target.value)}
                aria-label="Custom activity name"
              />
            )}
            <select
              className="reschedule-select"
              value={activityDay}
              onChange={(e) => setActivityDay(e.target.value)}
              aria-label="Day for the activity"
            >
              {DAY_ORDER.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {/* Only free slots for the chosen day are offered — see
                freeSlotsForDay above. Tapping a row adds/removes that slot
                immediately — no separate Add step, no separate "selected
                slots" list any more either (2026-09-07: "remove the
                selected slots ... view and make it so if i click on slot
                and it become library slot") — the slot itself IS the
                feedback: an assigned slot's label switches from "Slot N ·
                time" to the activity's own name (e.g. "Library"), with the
                slot/time demoted to a small second line, `.is-checked`
                highlighted. **A row shows whatever's actually assigned to
                it, independent of the Type dropdown's current selection**
                (2026-09-07 follow-up: "when i switch to cafe the library on
                slots must remain") — switching the dropdown to "Cafe" must
                not make an already-showing "Library" slot look unassigned
                just because it isn't Cafe. Tapping an assigned row removes
                *that slot's own* activity (whatever it is); tapping an
                unassigned row assigns the currently-selected type. Plain
                tappable rows, not checkboxes (a still-earlier request:
                "remove check box from slots") — same .option-row-sync
                button style as CourseDropdown/SyncOptionRow use. */}
            <span className="room-field-label">Time slots</span>
            <div className="activity-slot-list">
              {freeSlotsForDay.length === 0 ? (
                <div className="combobox-empty">No free slots on {activityDay}.</div>
              ) : (
                freeSlotsForDay.map((s) => {
                  const i = timeSlots.indexOf(s);
                  // Whatever's actually assigned to this slot, regardless
                  // of the currently-selected Type — see toggleActivitySlot.
                  const existing = activities.find((a) => a.day === activityDay && a.time === s);
                  const slotLabel = `Slot ${i + 1} · ${formatSlot(s).start}`;

                  // An assigned slot is no longer itself the tap target
                  // (2026-09-07, on request: "add cross button to remove
                  // activity from a slot") — a <button> can't contain
                  // another <button>, so this becomes a static row with an
                  // explicit `.chip-remove` X, same red-circle remove
                  // control "Selected courses"' chips already use. An
                  // unassigned slot stays a single tap-to-assign button.
                  if (existing) {
                    // Tinted per the activity's own colour (2026-09-09, on
                    // request: "different activities have different color in
                    // slot when they are selected") — same fixed palette and
                    // dotted-box treatment as its actual box on the weekly
                    // grid (`getActivityColor`, `TimetableGrid.jsx`), so a
                    // Library slot and a Cafe slot read as visually distinct
                    // here too, not just a uniform "assigned" highlight.
                    const color = getActivityColor(existing.type);
                    return (
                      <div
                        key={s}
                        className="option-row option-row-sync option-row-static is-checked"
                        style={{ backgroundColor: withAlpha(color, 0.16), borderLeft: `3px solid ${color}` }}
                      >
                        <span className="option-text">
                          <span className="option-course">{existing.type}</span>
                          <span className="option-section">{slotLabel}</span>
                        </span>
                        <button
                          type="button"
                          className="chip-remove"
                          aria-label={`Remove ${existing.type} from ${slotLabel}`}
                          onClick={() => toggleActivitySlot(s)}
                        >
                          <IconX size={16} />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={s}
                      type="button"
                      className="option-row option-row-sync"
                      onClick={() => toggleActivitySlot(s)}
                    >
                      <span className="option-text">
                        <span className="option-course">{slotLabel}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </Modal>
      )}
      </section>
    </>
  );
};

export default ClassSelector;
