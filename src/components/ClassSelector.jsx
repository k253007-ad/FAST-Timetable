import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { splitClassValue, formatClassLabel } from '../utils/courseColors.js';
import { IconChevronDown, IconSearch, IconX } from './Icons.jsx';

/**
 * Searchable multi-select for course sections, with the current selection
 * shown as removable chips. Stored values keep the legacy
 * "Course - Section" format so existing saved selections keep working.
 *
 * Two selection modes:
 *  - Manual: pick individual course sections one at a time (original flow).
 *  - Auto: pick a student section (e.g. "BCS-3A") or a teacher name and
 *    every class belonging to it is added/removed as a group.
 *
 * The card can also be minimized (collapses everything but the mode/profile
 * toolbar), and holds up to `profileCount` independent saved timetables
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
  const [mode, setMode] = useState('manual'); // 'manual' | 'auto'
  const [autoType, setAutoType] = useState('student'); // 'student' | 'teacher'
  const [query, setQuery] = useState('');
  const [autoQuery, setAutoQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const rootRef = useRef(null);
  const comboboxRef = useRef(null);
  const inputRef = useRef(null);
  const autoInputRef = useRef(null);
  const panelId = useId();
  const autoPanelId = useId();

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
        (mode === 'manual' ? inputRef : autoInputRef).current?.focus();
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

  // Group every class by student section and by instructor, so auto-select
  // can add/remove a whole group ("BCS-3A", or a teacher's name) at once.
  const { sectionGroups, instructorGroups } = useMemo(() => {
    if (!data?.timetable) return { sectionGroups: [], instructorGroups: [] };

    const sectionMap = new Map();
    const instructorMap = new Map();

    data.timetable.forEach((item) => {
      const value = `${item.Course} - ${item.Section}`;

      if (item.Section && item.Section !== 'N/A') {
        if (!sectionMap.has(item.Section)) sectionMap.set(item.Section, new Set());
        sectionMap.get(item.Section).add(value);
      }
      if (item.Instructor && item.Instructor !== 'N/A') {
        if (!instructorMap.has(item.Instructor)) instructorMap.set(item.Instructor, new Set());
        instructorMap.get(item.Instructor).add(value);
      }
    });

    const toGroups = (map) =>
      [...map.entries()]
        .map(([name, classSet]) => ({ name, classes: [...classSet] }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return { sectionGroups: toGroups(sectionMap), instructorGroups: toGroups(instructorMap) };
  }, [data]);

  const autoGroups = autoType === 'student' ? sectionGroups : instructorGroups;

  const filteredAutoGroups = useMemo(() => {
    const tokens = autoQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return autoGroups;
    return autoGroups.filter((group) => {
      const haystack = group.name.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [autoGroups, autoQuery]);

  const isGroupSelected = (classes) => classes.length > 0 && classes.every((c) => selectedClasses.includes(c));

  const toggleGroup = (classes) => {
    setSelectedClasses((prev) => {
      const allSelected = classes.every((c) => prev.includes(c));
      if (allSelected) return prev.filter((c) => !classes.includes(c));
      return [...new Set([...prev, ...classes])];
    });
  };

  const switchAutoType = (type) => {
    setAutoType(type);
    setAutoQuery('');
    setOpen(false);
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setOpen(false);
  };

  const toggleMinimized = () => {
    setOpen(false);
    setMinimized((v) => !v);
  };

  const profileNumbers = Array.from({ length: profileCount }, (_, i) => i + 1);

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
        <div className="mode-tabs" role="tablist" aria-label="Selection mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'manual'}
            className={`mode-tab${mode === 'manual' ? ' is-active' : ''}`}
            onClick={() => switchMode('manual')}
          >
            Manual select
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'auto'}
            className={`mode-tab${mode === 'auto' ? ' is-active' : ''}`}
            onClick={() => switchMode('auto')}
          >
            Auto select
          </button>
        </div>

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
            {profileNumbers.map((n) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={activeProfile === n}
                className={`profile-tab${activeProfile === n ? ' is-active' : ''}`}
                onClick={() => onSwitchProfile(n)}
                title={`Timetable ${n}`}
              >
                {n}
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

      {!minimized && mode === 'auto' && (
        <div className="auto-panel">
          <div className="auto-type-tabs" role="tablist" aria-label="Auto-select by">
            <button
              type="button"
              role="tab"
              aria-selected={autoType === 'student'}
              className={`auto-type-tab${autoType === 'student' ? ' is-active' : ''}`}
              onClick={() => switchAutoType('student')}
            >
              Student
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={autoType === 'teacher'}
              className={`auto-type-tab${autoType === 'teacher' ? ' is-active' : ''}`}
              onClick={() => switchAutoType('teacher')}
            >
              Teacher
            </button>
          </div>

          <div className="combobox" ref={comboboxRef}>
            <span className="combobox-icon">
              <IconSearch size={17} />
            </span>
            <input
              ref={autoInputRef}
              type="text"
              className="combobox-input"
              placeholder={
                autoType === 'student'
                  ? 'Search your section — e.g. “BCS-3A”'
                  : 'Search instructor name'
              }
              value={autoQuery}
              disabled={!hasData}
              onChange={(e) => {
                setAutoQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              role="combobox"
              aria-expanded={open}
              aria-controls={autoPanelId}
              aria-label={autoType === 'student' ? 'Search student sections' : 'Search instructors'}
              autoComplete="off"
              spellCheck="false"
            />
            {autoQuery && (
              <button
                type="button"
                className="combobox-clear"
                aria-label="Clear search"
                onClick={() => {
                  setAutoQuery('');
                  autoInputRef.current?.focus();
                }}
              >
                <IconX size={15} />
              </button>
            )}

            {open && hasData && (
              <div
                className="combobox-panel"
                id={autoPanelId}
                role="group"
                aria-label={autoType === 'student' ? 'Matching sections' : 'Matching instructors'}
              >
                <div className="combobox-meta">
                  {filteredAutoGroups.length === autoGroups.length
                    ? `${autoGroups.length} ${autoType === 'student' ? 'sections' : 'instructors'}`
                    : `${filteredAutoGroups.length} of ${autoGroups.length} ${autoType === 'student' ? 'sections' : 'instructors'}`}
                </div>
                <div className="combobox-list">
                  {filteredAutoGroups.length === 0 ? (
                    <div className="combobox-empty">
                      No {autoType === 'student' ? 'sections' : 'instructors'} match “{autoQuery}”.
                    </div>
                  ) : (
                    filteredAutoGroups.map((group) => {
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
