'use client';
import React, { useRef, useEffect, ReactNode } from 'react';

export interface ColDef {
  label: ReactNode;
  className?: string;
}

interface Props {
  columns: ColDef[];
  children: ReactNode;
  className?: string;
}

/**
 * Drop-in replacement for the data-table-wrap + table + thead + tbody pattern.
 * Injects draggable resize handles between column headers after mount.
 * On the first drag, switches the table to fixed layout and locks each
 * column to its measured pixel width, then adjusts only the dragged column.
 */
export default function ResizableTable({ columns, children, className }: Props) {
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const ths = Array.from(
      table.querySelectorAll<HTMLElement>('thead > tr > th')
    );

    let isFixed = false;
    const cleanups: Array<() => void> = [];

    ths.forEach((th, idx) => {
      if (idx === ths.length - 1) return; // no handle after last column

      th.style.position = 'relative';
      th.style.userSelect = 'none';

      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      const onMouseDown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Freeze all column widths on first drag
        if (!isFixed) {
          ths.forEach(t => { t.style.width = t.offsetWidth + 'px'; });
          table.style.tableLayout = 'fixed';
          isFixed = true;
        }

        const startX  = e.clientX;
        const startW  = th.offsetWidth;

        const onMove = (ev: MouseEvent) => {
          th.style.width = Math.max(40, startW + (ev.clientX - startX)) + 'px';
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.body.style.cursor     = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
      };

      handle.addEventListener('mousedown', onMouseDown);
      cleanups.push(() => {
        handle.removeEventListener('mousedown', onMouseDown);
        if (handle.parentNode) handle.remove();
        th.style.position   = '';
        th.style.userSelect = '';
      });
    });

    return () => {
      cleanups.forEach(fn => fn());
      if (table) {
        table.style.tableLayout = '';
        ths.forEach(t => { t.style.width = ''; });
      }
      isFixed = false;
    };
  }, []); // runs on mount / remount (tab change triggers remount)

  return (
    <div className="data-table-wrap">
      <table
        ref={tableRef}
        className={`data-table${className ? ' ' + className : ''}`}
      >
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} className={col.className}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
