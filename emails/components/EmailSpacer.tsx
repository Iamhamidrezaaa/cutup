import { Section, Text } from '@react-email/components';

type Props = {
  height?: number;
};

/** Reliable vertical gap for table-based email layouts. */
export function EmailSpacer({ height = 20 }: Props) {
  const h = Math.max(4, height);
  return (
    <Section style={{ padding: 0, margin: 0, lineHeight: `${h}px`, fontSize: '1px' }}>
      <Text style={{ margin: 0, padding: 0, lineHeight: `${h}px`, fontSize: `${h}px`, color: 'transparent' }}>
        &nbsp;
      </Text>
    </Section>
  );
}
