import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  label: string;
  value: React.ReactNode;
  last?: boolean;
};

/** Stacked label → value rows (Gmail mobile safe, no two-column overflow). */
export function DetailRow({ label, value, last }: Props) {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      width="100%"
      style={{
        width: '100%',
        marginBottom: last ? 0 : '10px',
        paddingBottom: last ? 0 : '10px',
        borderBottom: last ? 'none' : `1px solid ${BRAND.border}`,
      }}
    >
      <tbody>
        <tr>
          <td
            className="email-word-break"
            style={{
              fontSize: '12px',
              color: BRAND.textMuted,
              paddingBottom: '3px',
              lineHeight: '1.3',
              fontWeight: 500,
            }}
          >
            {label}
          </td>
        </tr>
        <tr>
          <td
            className="email-word-break"
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: BRAND.text,
              lineHeight: '1.4',
              wordBreak: 'break-word',
            }}
          >
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
