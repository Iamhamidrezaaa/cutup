import { Text } from '@react-email/components';
import { BRAND } from '../brand';

type Props = {
  items: string[];
};

export function FeatureList({ items }: Props) {
  return (
    <>
      {items.map((item, i) => (
        <Text
          key={item}
          className="email-word-break"
          style={{
            margin: i === items.length - 1 ? '0' : '0 0 6px',
            fontSize: '14px',
            lineHeight: '1.4',
            color: BRAND.text,
          }}
        >
          <span style={{ color: BRAND.primary, marginRight: '6px' }}>✦</span>
          {item}
        </Text>
      ))}
    </>
  );
}
