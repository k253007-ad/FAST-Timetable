import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { splitClassValue, formatClassLabel } from '../utils/courseColors.js';
import { IconChevronDown, IconSearch, IconX } from './Icons.jsx';

/**
 * Searchable multi-select for course sections, with the current selection
 * shown as removable chips. Stored values keep the legacy
 * "Course - Section" format so existing saved selections keep working.
 *
 * Three selection modes (replaced the old Manual/Auto 2-tab layout on
 * 2026-08-25 — "Auto" used to nest Student-section/Teacher under one tab;
 * Student-section selection is gone entirely now that Roll No gives a more
 * precise, per-student pick, and Teacher is a top-level tab instead of a
 * sub-toggle):
 *  - Manual: pick individual course sections one at a time (original flow).
 *  - Roll No: pick a specific student's roll number (e.g. "25K-3068") and
 *    every class *that student* takes is added/removed as a group — built
 *    from `data.rollNumbers`, a separate optional data source (see
 *    dataService.js). More precise than section-based selection since
 *    electives vary per student even within the same nominal section.
 *  - Teacher: pick a teacher name and every class they teach is added/
 *    removed as a group — built from `data.timetable`, same as before.
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
  courseColors,
  activeProfile,
  profileCount,
  onSwitchProfile,
}) => {
  const [mode, setMode] = useState('manual'); // 'manual' | 'rollno' | 'teacher'
  const [query, setQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState(''); // shared search box for roll no + teacher tabs
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const rootRef = useRef(null);
  const comboboxRef = useRef(null);
  const inputRef = useRef(null);
  const groupInputRef = useRef(null);
  const panelId = useId();
  const groupPanelId = useId();

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

  const toggleClass = (value) => {
    setSelectedClasses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const removeClass = (value) => {
    setSelectedClasses((prev) => prev.filter((v) => v !== value));
  };

  const hasData = allClasses.length > 0;
  const hasRollData = (data?.rollNumbers?.length ?? 0) > 0;

  // Group every class by instructor (Teacher tab) and every roll number's
  // classes by that roll number (Roll No tab), so each tab can add/remove a
  // whole group at once.
  const { instructorGroups, rollNoGroups } = useMemo(() => {
    const instructorMap = new Map();
    (data?.timetable || []).forEach((item) => {
      if (item.Instructor && item.Instructor !== 'N/A') {
        const value = `${item.Course} - ${item.Section}`;
        if (!instructorMap.has(item.Instructor)) instructorMap.set(item.Instructor, new Set());
        instructorMap.get(item.Instructor).add(value);
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

    return { instructorGroups: toGroups(instructorMap), rollNoGroups: toGroups(rollMap) };
  }, [data]);

  const groups = useMemo(
    () => (mode === 'rollno' ? rollNoGroups : mode === 'teacher' ? instructorGroups : []),
    [mode, rollNoGroups, instructorGroups]
  );

  const filteredGroups = useMemo(() => {
    const tokens = groupQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return groups;
    return groups.filter((group) => {
      const haystack = group.name.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [groups, groupQuery]);

  const isGroupSelected = (classes) => classes.length > 0 && classes.every((c) => selectedClasses.includes(c));

  const toggleGroup = (classes) => {
    setSelectedClasses((prev) => {
      const allSelected = classes.every((c) => prev.includes(c));
      if (allSelected) return prev.filter((c) => !classes.includes(c));
      return [...new Set([...prev, ...classes])];
    });
  };

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

  const groupUnitLabel = mode === 'rollno' ? 'roll numbers' : 'instructors';
  const groupPlaceholder =
    mode === 'rollno' ? 'Search your roll number — e.g. “25K-3068”' : 'Search instructor name';
  const groupAriaLabel = mode === 'rollno' ? 'Search roll numbers' : 'Search instructors';

  return (
    <section className="card selector-card no-print" ref={rootRef}>
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
        {!minimized && (
          <div className="mode-tabs" role="tablist" aria-label="Selection mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'manual'}
              className={`mode-tab${mode === 'manual' ? ' is-active' : ''}`}
              onClick={() => switchMode('manual')}
            >
              Manual
            </button>
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
              aria-selected={mode === 'teacher'}
              className={`mode-tab${mode === 'teacher' ? ' is-active' : ''}`}
              onClick={() => switchMode('teacher')}
            >
              Teacher
            </button>
          </div>
        )}

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
      </div>

      {!minimized && mode === 'manual' && (
        <div className="combobox" ref={comboboxRef}>
          <span className="combobox-icon">
            <IconSearch size={17} />
          </span>
          <input
            ref={inputRef}
            type="text"
            className="combobox-input"
            placeholder={hasData ? 'Search courses or sections — e.g. “CS2005” or “OOP 2A”' : 'No sections available'}
            value={query}
            disabled={!hasData}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            role="combobox"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label="Search course sections"
            autoComplete="off"
            spellCheck="false"
          />
          {query && (
            <button
              type="button"
              className="combobox-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <IconX size={15} />
            </button>
          )}

          {open && hasData && (
            <div className="combobox-panel" id={panelId} role="group" aria-label="Matching sections">
              <div className="combobox-meta">
                {filtered.length === allClasses.length
                  ? `${allClasses.length} sections`
                  : `${filtered.length} of ${allClasses.length} sections`}
              </div>
              <div className="combobox-list">
                {filtered.length === 0 ? (
                  <div className="combobox-empty">No sections match “{query}”.</div>
                ) : (
                  filtered.map((value) => {
                    const { course, section } = splitClassValue(value);
                    const checked = selectedClasses.includes(value);
                    return (
                      <label key={value} className={`option-row${checked ? ' is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          className="option-checkbox"
                          checked={checked}
                          onChange={() => toggleClass(value)}
                        />
                        <span className="option-text">
                          <span className="option-course">{course}</span>
                          {section && <span className="option-section">{section}</span>}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!minimized && mode === 'rollno' && !hasRollData && (
        <p className="selector-hint">
          Roll-number selection isn’t available yet — check back once this data source is
          connected.
        </p>
      )}

      {!minimized && (mode === 'rollno' || mode === 'teacher') && (mode === 'teacher' || hasRollData) && (
        <div className="combobox" ref={comboboxRef}>
          <span className="combobox-icon">
            <IconSearch size={17} />
          </span>
          <input
            ref={groupInputRef}
            type="text"
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
            role="combobox"
            aria-expanded={open}
            aria-controls={groupPanelId}
            aria-label={groupAriaLabel}
            autoComplete="off"
            spellCheck="false"
          />
          {groupQuery && (
            <button
              type="button"
              className="combobox-clear"
              aria-label="Clear search"
              onClick={() => {
                setGroupQuery('');
                groupInputRef.current?.focus();
              }}
            >
              <IconX size={15} />
            </button>
          )}

          {open && hasData && (
            <div
              className="combobox-panel"
              id={groupPanelId}
              role="group"
              aria-label={groupAriaLabel}
            >
              <div className="combobox-meta">
                {filteredGroups.length === groups.length
                  ? `${groups.length} ${groupUnitLabel}`
                  : `${filteredGroups.length} of ${groups.length} ${groupUnitLabel}`}
              </div>
              <div className="combobox-list">
                {filteredGroups.length === 0 ? (
                  <div className="combobox-empty">
                    No {groupUnitLabel} match “{groupQuery}”.
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const checked = isGroupSelected(group.classes);
                    return (
                      <label key={group.name} className={`option-row${checked ? ' is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          className="option-checkbox"
                          checked={checked}
                          onChange={() => toggleGroup(group.classes)}
                        />
                        <span className="option-text">
                          <span className="option-course">{group.name}</span>
                          <span className="option-section">
                            {group.classes.length} class{group.classes.length === 1 ? '' : 'es'}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!minimized &&
        (selectedClasses.length > 0 ? (
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
                    <IconX size={13} />
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
        ))}
    </section>
  );
};

export default ClassSelector;
