"use client";
import { useState, useEffect } from "react";
import proj4 from "proj4";

// Quick UTM generator
const generateUtmProj4 = (zone, isSouth, datum = "WGS84", units = "m") => {
  return `+proj=utm +zone=${zone} ${isSouth ? "+south " : ""}+datum=${datum} +units=${units} +no_defs`;
};

export default function ProjectionSelector({ isOpen, onClose, initialDetails, onSave }) {
  const [epsgSearch, setEpsgSearch] = useState("");
  const [projectionType, setProjectionType] = useState("UTM");
  const [zone, setZone] = useState(44);
  const [hemisphere, setHemisphere] = useState("N");
  const [datum, setDatum] = useState("WGS84");
  const [units, setUnits] = useState("m");

  const [customProj4, setCustomProj4] = useState("");
  const [isCustom, setIsCustom] = useState(false);

  useEffect(() => {
    if (initialDetails) {
       if (initialDetails.zone) setZone(initialDetails.zone);
       if (initialDetails.epsg) {
         setEpsgSearch(initialDetails.epsg.replace('EPSG:', ''));
       }
       if (initialDetails.units && initialDetails.units.toLowerCase().includes("feet")) {
         setUnits("us-ft");
       }
       if (initialDetails.datum) {
         if (initialDetails.datum.toUpperCase().includes("WGS") || initialDetails.datum.includes("84")) setDatum("WGS84");
         else if (initialDetails.datum.toUpperCase().includes("NAD") && initialDetails.datum.includes("83")) setDatum("NAD83");
       }
       
       if (initialDetails.proj4String) {
           setCustomProj4(initialDetails.proj4String);
           setIsCustom(true);
       }
    }
  }, [initialDetails]);

  if (!isOpen) return null;

  const handleSave = () => {
    let proj4String = "";
    let epsg = epsgSearch ? `EPSG:${epsgSearch}` : null;

    if (isCustom && customProj4) {
      proj4String = customProj4;
    } else if (projectionType === "UTM") {
      proj4String = generateUtmProj4(zone, hemisphere === "S", datum, units);
      if (!epsgSearch) {
        // approximate EPSG for WGS84 UTM
        if (datum === "WGS84") {
           epsg = `EPSG:${hemisphere === 'N' ? 32600 + Number(zone) : 32700 + Number(zone)}`;
        }
      }
    }
    
    // Test proj4String
    try {
       proj4(proj4String, 'EPSG:4326', [0, 0]);
    } catch (err) {
       alert("Invalid projection parameters. Cannot generate a valid coordinate system.");
       return;
    }

    onSave({ proj4String, epsg });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-secondary)', width: '450px', maxWidth: '95%',
        borderRadius: '8px', padding: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        border: '1px solid var(--border-color)', color: 'var(--text-primary)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Select Projection</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>
        
        <div>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: 'var(--text-secondary)' }}>Search by EPSG Code:</label>
            <div style={{ display: 'flex', gap: '8px' }}>
               <input 
                 type="text" 
                 value={epsgSearch} 
                 onChange={e => setEpsgSearch(e.target.value)} 
                 placeholder="e.g. 32644" 
                 style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
               />
               <button className="btn-secondary">Search</button>
            </div>
            <small style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>If you know the exact EPSG code, enter it above.</small>
          </div>

          <hr style={{ margin: '15px 0', borderColor: 'var(--border-color)' }} />
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: 'var(--text-secondary)' }}>Quick Presets (India):</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[42, 43, 44, 45, 46, 47].map(z => (
                <button
                  key={z}
                  onClick={() => {
                    setIsCustom(false);
                    setProjectionType("UTM");
                    setZone(z);
                    setHemisphere("N");
                    setDatum("WGS84");
                    setUnits("m");
                    setEpsgSearch(`326${z}`);
                  }}
                  style={{
                    padding: '4px 8px', fontSize: '12px', borderRadius: '4px',
                    background: (!isCustom && zone == z && hemisphere === 'N') ? 'var(--primary-color)' : 'var(--bg-primary)',
                    color: (!isCustom && zone == z && hemisphere === 'N') ? '#fff' : 'var(--text-primary)',
                    border: '1px solid var(--border-color)', cursor: 'pointer'
                  }}
                >
                  UTM {z}N
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', fontSize: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input type="radio" checked={!isCustom} onChange={() => setIsCustom(false)} />
              Standard UTM
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input type="radio" checked={isCustom} onChange={() => setIsCustom(true)} />
              Custom Proj4
            </label>
          </div>

          {!isCustom ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
               <div>
                 <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-secondary)' }}>Zone (1-60):</label>
                 <input 
                   type="number" 
                   min="1" max="60" 
                   value={zone} 
                   onChange={e => setZone(e.target.value)} 
                   style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                 />
               </div>
               <div>
                 <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-secondary)' }}>Hemisphere:</label>
                 <select value={hemisphere} onChange={e => setHemisphere(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                   <option value="N">Northern Hemisphere</option>
                   <option value="S">Southern Hemisphere</option>
                 </select>
               </div>
               <div>
                 <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-secondary)' }}>Datum:</label>
                 <select value={datum} onChange={e => setDatum(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                   <option value="WGS84">WGS 84</option>
                   <option value="NAD83">NAD 83</option>
                   <option value="NAD27">NAD 27</option>
                 </select>
               </div>
               <div>
                 <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-secondary)' }}>Planar Units:</label>
                 <select value={units} onChange={e => setUnits(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                   <option value="m">Meters</option>
                   <option value="us-ft">US Survey Feet</option>
                   <option value="ft">International Feet</option>
                 </select>
               </div>
            </div>
          ) : (
            <div>
               <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-secondary)' }}>Proj4 String:</label>
               <textarea 
                 value={customProj4} 
                 onChange={e => setCustomProj4(e.target.value)} 
                 placeholder="+proj=utm +zone=44 +datum=WGS84 +units=m +no_defs"
                 style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                 rows={4}
               />
               <small style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>Advanced: Provide the exact Proj4 definition.</small>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '25px' }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Apply Projection</button>
        </div>
      </div>
    </div>
  );
}
