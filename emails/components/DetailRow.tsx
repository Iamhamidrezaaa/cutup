import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  label: string;
  value: React.ReactNode;
  last?: boolean;
};

/** Desktop: label | value. Mobile (≤600px): stacked via media query. */
export function DetailRow({ label, value, last }: Props) {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      width="100%"
      className="email-detail-row"
      style={{
        width: '100%',
        tableLayout: 'fixed',
        marginBottom: last ? 0 : '12px',
        borderBottom: last ? 'none' : `1px solid ${BRAND.border}`,
        paddingBottom: last ? 0 : '12px',
      }}
    >
      <tbody>
        <tr>
          <td className="email-detail-label email-word-break">{label}</td>
          <td className="email-detail-value email-word-break">{value}</td>
        </tr>
      </tbody>
    </table>
  );
}
