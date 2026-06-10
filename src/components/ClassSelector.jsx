import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { splitClassValue, formatClassLabel } from '../utils/courseColors.js';
import { IconSearch, IconX } from './Icons.jsx';

/**
 * Searchable multi-select for course sections, with the current selection
 * shown as removable chips. Stored values keep the legacy
 * "Course - Section" format so existing saved selections keep working.
 */
const ClassSelector = ({ allClasses, selectedClasses, setSelectedClasses, courseColors }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const panelId = useId();

  // Close on outside click / Escape while the dropdown is open.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Refocus first: the input's onFocus sets open=true, and the
        // close below must win when React batches the two updates.
        inputRef.current?.focus();
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

  const toggleClass = (value) => {
    setSelectedClasses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const removeClass = (value) => {
    setSelectedClasses((prev) => prev.filter((v) => v !== value));
  };

  const hasData = allClasses.length > 0;

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

      <div className="combobox">
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
                  <IconX size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="selector-hint">
          Pick the sections you’re enrolled in — your timetable builds itself below and stays saved
          on this device.
        </p>
      )}
    </section>
  );
};

export default ClassSelector;
