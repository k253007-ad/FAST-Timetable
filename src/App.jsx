import React, { useState, useEffect, useRef } from 'react';
import TimetableGrid from './components/TimetableGrid.jsx';
import ClassSelector from './components/ClassSelector.jsx';
import { fetchData } from './services/dataService.js';
import html2canvas from 'html2canvas';
import './index.css'; // Import the global styles

function App() {
  const [timetableData, setTimetableData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedClasses, setSelectedClasses] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedClasses');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to parse selectedClasses from localStorage", e);
      return [];
    }
  });

  const timetableRef = useRef(); // Ref for the timetable grid

  // Effect to save selected classes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('selectedClasses', JSON.stringify(selectedClasses));
    } catch (e) {
      console.error("Failed to save selectedClasses to localStorage", e);
    }
  }, [selectedClasses]);

  const getData = async () => {
    try {
      setLoading(true);
      const data = await fetchData();
      setTimetableData(data);
      setError(null);
    } catch (err) {
      setError('Failed to load timetable data. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getData(); // Initial data fetch
    const intervalId = setInterval(getData, 3600000); // Fetch data every hour

    return () => clearInterval(intervalId); // Cleanup interval on component unmount
  }, []);

   const handleRefresh = () => {
    getData();
  };

  const handleDownloadImage = (format) => {
    const timetableElement = timetableRef.current;
    if (timetableElement) {
      const originalWidth = timetableElement.style.width;
      timetableElement.style.width = '1200px'; // Force a large width

      setTimeout(() => {
        html2canvas(timetableElement, { 
          scale: 2,
          windowWidth: timetableElement.scrollWidth, // Ensure canvas is wide enough
          windowHeight: timetableElement.scrollHeight
        }).then((canvas) => {
          const imageType = format === 'png' ? 'image/png' : 'image/jpeg';
          const imgData = canvas.toDataURL(imageType);
          
          const link = document.createElement('a');
          link.href = imgData;
          link.download = `timetable.${format}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          timetableElement.style.width = originalWidth; // Restore original width
        });
      }, 150); // Increased delay to be safer
    }
  };

  if (loading) {
    return (
      <div className="app-message">
        <h3>Loading Timetable...</h3>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-message app-error">
        <h3>Error: {error}</h3>
      </div>
    );
  }

  const allClasses = timetableData ? [...new Set(timetableData.timetable.map(item => `${item.Course} - ${item.Section}`))] : [];

  return (
    <div className="app-container">
      <div className="app-header no-print">
        <h2>Timetable Generator</h2>
        <button onClick={handleRefresh} className="download-button">Refresh</button>
        <button onClick={() => handleDownloadImage('png')} className="download-button">Download PNG</button>
        <button onClick={() => handleDownloadImage('jpg')} className="download-button">Download JPG</button>
      </div>
      <div className="app-content-wrapper">
        <ClassSelector 
          data={timetableData} 
          allClasses={allClasses} 
          selectedClasses={selectedClasses} 
          setSelectedClasses={setSelectedClasses} 
        />
        <div ref={timetableRef}> {/* Attach ref to the div wrapping TimetableGrid */}
          <TimetableGrid 
            data={timetableData}
            selectedClasses={selectedClasses} 
          />
        </div>
      </div>
    </div>
  );
}

export default App;