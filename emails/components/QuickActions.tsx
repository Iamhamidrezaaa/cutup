import { Link, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';
import { EmailBlock } from './EmailBlock';

type Action = {
  icon: string;
  title: string;
  description: string;
  href: string;
};

const DEFAULT_ACTIONS: Action[] = [
  { icon: '🎙', title: 'Create Transcript', description: 'AI transcripts instantly', href: SITE.dashboardUrl },
  { icon: '🌍', title: 'Translate Video', description: 'Multi-language translation', href: SITE.dashboardUrl },
  { icon: '🎬', title: 'Export MP4', description: 'Shareable video exports', href: SITE.dashboardUrl },
];

type Props = {
  dashboardUrl?: string;
};

export function QuickActions({ dashboardUrl }: Props) {
  const base = dashboardUrl || SITE.dashboardUrl;
  const actions = DEFAULT_ACTIONS.map((a) => ({
    ...a,
    href: a.href.replace(SITE.dashboardUrl, base),
  }));

  return (
    <EmailBlock padding={BRAND.actionsPad}>
      <Text
        style={{
          margin: '0 0 14px',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: BRAND.textMuted,
        }}
      >
        Quick actions
      </Text>
      <table cellPadding={0} cellSpacing={0} role="presentation" width="100%" style={{ width: '100%' }}>
        <tbody>
          {actions.map((action, i) => (
            <tr key={action.title}>
              <td style={{ paddingBottom: i < actions.length - 1 ? '12px' : 0 }}>
                <table
                  cellPadding={0}
                  cellSpacing={0}
                  role="presentation"
                  width="100%"
                  style={{
                    width: '100%',
                    backgroundColor: BRAND.surface,
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: BRAND.radius,
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: '16px 18px' }}>
                        <Link href={action.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <table cellPadding={0} cellSpacing={0} role="presentation" width="100%">
                            <tbody>
                              <tr>
                                <td
                                  width="36"
                                  style={{
                                    width: '36px',
                                    verticalAlign: 'middle',
                                    fontSize: '24px',
                                    lineHeight: '1',
                                    paddingRight: '14px',
                                  }}
                                >
                                  {action.icon}
                                </td>
                                <td style={{ verticalAlign: 'middle' }}>
                                  <Text
                                    style={{
                                      margin: 0,
                                      fontSize: '15px',
                                      fontWeight: 600,
                                      color: BRAND.text,
                                      lineHeight: '1.3',
                                    }}
                                  >
                                    {action.title}
                                  </Text>
                                  <Text
                                    style={{
                                      margin: '4px 0 0',
                                      fontSize: '13px',
                                      color: BRAND.textMuted,
                                      lineHeight: '1.4',
                                    }}
                                  >
                                    {action.description}
                                  </Text>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </Link>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </EmailBlock>
  );
}
