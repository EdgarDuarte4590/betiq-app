'use client';

import { useEffect, useState } from 'react';

export default function LocalTime({ 
  isoString, 
  format = 'time' 
}: { 
  isoString?: string, 
  format?: 'time' | 'date' 
}) {
  const [formatted, setFormatted] = useState('');

  useEffect(() => {
    try {
      const d = isoString ? new Date(isoString) : new Date();
      
      if (format === 'time') {
        setFormatted(d.toLocaleTimeString('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit' }));
      } else {
        setFormatted(d.toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }));
      }
    } catch {
      setFormatted('--');
    }
  }, [isoString, format]);

  return <>{formatted || (format === 'time' ? '--:--' : 'Cargando...')}</>;
}
