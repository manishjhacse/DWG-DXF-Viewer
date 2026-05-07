"use client";

export default function EntityInspector({ entity, onClose }) {
  if (!entity) return null;

  const renderValue = (val) => {
    if (typeof val === 'number') return val.toFixed(4);
    if (typeof val === 'object' && val !== null) {
      if ('x' in val && 'y' in val) {
        return `X: ${val.x.toFixed(2)}, Y: ${val.y.toFixed(2)}`;
      }
      return JSON.stringify(val);
    }
    return val || '—';
  };

  const getLabelForProp = (prop) => {
    const labels = {
      type: 'Entity Type',
      layer: 'Layer',
      color: 'ACI Color',
      startPoint: 'Start Point',
      endPoint: 'End Point',
      center: 'Center',
      radius: 'Radius',
      text: 'Content',
      height: 'Height',
      rotation: 'Rotation',
      closed: 'Closed'
    };
    return labels[prop] || prop.charAt(0).toUpperCase() + prop.slice(1);
  };

  const visibleProps = Object.keys(entity).filter(k => 
    !['id', 'points', 'vertices', 'boundaries', 'fitPoints', 'controlPoints'].includes(k)
  );

  return (
    <div className="entity-inspector floating-panel animate-slide-in">
      <div className="inspector-header">
        <h3>Property Inspector</h3>
        <button className="inspector-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      
      <div className="inspector-content">
        {visibleProps.map(prop => (
          <div key={prop} className="inspector-prop">
            <div className="inspector-prop-label">{getLabelForProp(prop)}</div>
            <div className="inspector-prop-value">{renderValue(entity[prop])}</div>
          </div>
        ))}
        
        {entity.vertices?.length > 0 && (
          <div className="inspector-prop">
            <div className="inspector-prop-label">Vertices</div>
            <div className="inspector-prop-value">{entity.vertices.length} points</div>
          </div>
        )}
      </div>
    </div>
  );
}
