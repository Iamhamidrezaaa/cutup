import { Text } from '@react-email/components';
import { PLAN_COLORS } from '../brand';

type Props = {
  plan: string;
};

export function PlanBadge({ plan }: Props) {
  const key = String(plan || 'starter').trim().toLowerCase();
  const colors = PLAN_COLORS[key] || PLAN_COLORS.pro;

  return (
    <Text
      style={{
        display: 'inline-block',
        margin: '0 0 10px',
        padding: '5px 12px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '0.02em',
        backgroundColor: colors.bg,
        color: colors.text,
        lineHeight: '1',
      }}
    >
      {plan}
    </Text>
  );
}
