import { Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';

type Action = {
  icon: string;
  title: string;
  description: string;
  href: string;
};

const DEFAULT_ACTIONS: Action[] = [
  {
    icon: '🎙',
    title: 'Create Transcript',
    description: 'AI transcripts instantly',
    href: SITE.dashboardUrl,
  },
  {
    icon: '🌍',
    title: 'Translate Video',
    description: 'Multi-language translation',
    href: SITE.dashboardUrl,
  },
  {
    icon: '🎬',
    title: 'Export MP4',
    description: 'Shareable video exports',
    href: SITE.dashboardUrl,
  },
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
    <Section className="email-pad-x" style={{ padding: `8px ${BRAND.padX} 32px` }}>
      <Text
        style={{
          margin: '0 0 12px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
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
              <td style={{ paddingBottom: i < actions.length - 1 ? '10px' : 0 }}>
                <table
                  cellPadding={0}
                  cellSpacing={0}
                  role="presentation"
                  width="100%"
                  style={{
                    width: '100%',
                    backgroundColor: BRAND.card,
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: BRAND.radius,
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: '14px 16px' }}>
                        <Link href={action.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <table cellPadding={0} cellSpacing={0} role="presentation" width="100%">
                            <tbody>
                              <tr>
                                <td
                                  width="32"
                                  style={{
                                    width: '32px',
                                    verticalAlign: 'top',
                                    fontSize: '22px',
                                    lineHeight: '1',
                                    paddingRight: '10px',
                                  }}
                                >
                                  {action.icon}
                                </td>
                                <td style={{ verticalAlign: 'top' }}>
                                  <Text
                                    style={{
                                      margin: 0,
                                      fontSize: '14px',
                                      fontWeight: 600,
                                      color: BRAND.text,
                                      lineHeight: '1.25',
                                    }}
                                  >
                                    {action.title}
                                  </Text>
                                  <Text
                                    style={{
                                      margin: '2px 0 0',
                                      fontSize: '12px',
                                      color: BRAND.textMuted,
                                      lineHeight: '1.35',
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
    </Section>
  );
}
