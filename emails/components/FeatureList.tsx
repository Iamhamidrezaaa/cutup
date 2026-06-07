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
          style={{
            margin: i === items.length - 1 ? '0' : '0 0 10px',
            fontSize: '15px',
            lineHeight: '1.5',
            color: BRAND.text,
            paddingLeft: '4px',
          }}
        >
          <span style={{ color: BRAND.primary, marginRight: '8px' }}>✦</span>
          {item}
        </Text>
      ))}
    </>
  );
}
