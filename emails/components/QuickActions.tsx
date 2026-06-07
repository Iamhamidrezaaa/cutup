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
    description: 'Generate AI transcripts instantly',
    href: `${SITE.dashboardUrl}?tool=transcript`,
  },
  {
    icon: '🌍',
    title: 'Translate Video',
    description: 'Translate into multiple languages',
    href: `${SITE.dashboardUrl}?tool=translate`,
  },
  {
    icon: '🎬',
    title: 'Export MP4',
    description: 'Create shareable videos',
    href: `${SITE.dashboardUrl}?tool=export`,
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
    <Section style={{ padding: '0 32px 24px' }}>
      <Text
        style={{
          margin: '0 0 12px',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: BRAND.textMuted,
        }}
      >
        Quick actions
      </Text>
      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: '100%' }}>
        <tbody>
          {actions.map((action, i) => (
            <tr key={action.title}>
              <td style={{ paddingBottom: i < actions.length - 1 ? '10px' : 0 }}>
                <Link
                  href={action.href}
                  style={{
                    display: 'block',
                    textDecoration: 'none',
                    backgroundColor: BRAND.card,
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: BRAND.radiusLg,
                    boxShadow: BRAND.shadowSm,
                    padding: '16px 18px',
                  }}
                >
                  <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: '100%' }}>
                    <tbody>
                      <tr>
                        <td style={{ width: '36px', verticalAlign: 'top', fontSize: '22px' }}>
                          {action.icon}
                        </td>
                        <td style={{ verticalAlign: 'top' }}>
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
                              lineHeight: '1.45',
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
          ))}
        </tbody>
      </table>
    </Section>
  );
}
