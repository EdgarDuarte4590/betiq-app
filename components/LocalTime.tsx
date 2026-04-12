'use client';

import { useEffect, useState } from 'react';

export default function LocalTime({ 
  isoString, 
  format = 'time' 
}: { 
  isoString?: string, 
  format?: 'time' | 'date' | 'datetime' 
}) {
  const [formatted, setFormatted] = useState('');

  useEffect(() => {
    try {
      const d = isoString ? new Date(isoString) : new Date();
      
      if (format === 'time') {
        setFormatted(d.toLocaleTimeString('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit' }));
      } else if (format === 'datetime') {
        const dateStr = d.toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', day: '2-digit', month: 'short' });
        const timeStr = d.toLocaleTimeString('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit' });
        setFormatted(`${dateStr}, ${timeStr}`);
      } else {
        setFormatted(d.toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }));
      }
    } catch {
      setFormatted('--');
    }
  }, [isoString, format]);

  return <>{formatted || (format === 'time' ? '--:--' : 'Cargando...')}</>;
}
