import React, { useState, useRef } from 'react';

const ClassSelector = ({ data, selectedClasses, setSelectedClasses }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false); // For dropdown behavior
  const containerRef = useRef(null);

  if (!data || !data.timetable) {
    return null;
  }

  // Create a unique list of classes (Course + Section)
  const allClasses = data.timetable.map(item => `${item.Course} - ${item.Section}`);
  const uniqueClasses = [...new Set(allClasses)].sort();

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
    setShowDropdown(true); // Always show dropdown when typing
  };

  const handleClassChange = (event) => {
    const { value, checked } = event.target;
    if (checked) {
      setSelectedClasses(prev => [...prev, value]);
    } else {
      setSelectedClasses(prev => prev.filter(className => className !== value));
    }
  };

  const handleFocus = () => {
    setShowDropdown(true);
  };

  const handleBlur = (e) => {
    // Check if the new focused element is outside the component
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget)) {
      setShowDropdown(false);
    }
  };

  const filteredClasses = uniqueClasses.filter(className =>
    className.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className="class-selector-container" 
      ref={containerRef} 
      onBlur={handleBlur} // Move blur handler to the container
    >
      <h3>Select Classes</h3>
      <input 
        type="text" 
        placeholder="Search Classes"
        value={searchQuery}
        onChange={handleSearchChange}
        onFocus={handleFocus}
        // onBlur is now on the container
        className="class-search-input"
      />
      {showDropdown && (
        <div className="class-list">
          {filteredClasses.map(className => (
            <label key={className} className="checkbox-label" onMouseDown={(e) => e.preventDefault()}>
              <input 
                type="checkbox"
                value={className}
                checked={selectedClasses.includes(className)}
                onChange={handleClassChange}
              />
              {className}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClassSelector;
