import type { BoardView, BoardCard } from '@instalogist/agent-office-adapter';
import { CardBadges } from './Badges';

function TaskCard({ card }: { card: BoardCard }): JSX.Element {
  return (
    <article className="card" aria-label={`Task ${card.item_key}`}>
      <div className="card-title">{card.title}</div>
      <div className="card-path" title={card.source_path}>
        {card.source_path}
      </div>
      <CardBadges card={card} />
    </article>
  );
}

export function BoardKanban({ board }: { board: BoardView }): JSX.Element {
  return (
    <div className="kanban" role="region" aria-label="Lifecycle kanban">
      {board.columns.map((col) => (
        <div key={col.id} className="column">
          <h3>
            {col.title}{' '}
            <span className="column-count">({col.cards.length})</span>
          </h3>
          {col.cards.map((c) => (
            <TaskCard key={c.item_key + c.source_path} card={c} />
          ))}
        </div>
      ))}
      {board.orphan_cards.length > 0 && (
        <div className="column" style={{ borderStyle: 'dashed' }}>
          <h3>
            Orphan / unknown status <span className="column-count">({board.orphan_cards.length})</span>
          </h3>
          {board.orphan_cards.map((c) => (
            <TaskCard key={c.item_key + c.source_path} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}
