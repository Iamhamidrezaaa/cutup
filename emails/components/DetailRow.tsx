import { Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  label: string;
  value: React.ReactNode;
  last?: boolean;
};

export function DetailRow({ label, value, last }: Props) {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{
        width: '100%',
        marginBottom: last ? 0 : '12px',
        borderBottom: last ? 'none' : `1px solid ${BRAND.border}`,
        paddingBottom: last ? 0 : '12px',
      }}
    >
      <tbody>
        <tr>
          <td
            style={{
              fontSize: '13px',
              color: BRAND.textMuted,
              paddingBottom: '4px',
              width: '40%',
              verticalAlign: 'top',
            }}
          >
            {label}
          </td>
          <td
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: BRAND.text,
              textAlign: 'right',
              verticalAlign: 'top',
            }}
          >
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
