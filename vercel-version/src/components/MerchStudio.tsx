import React, { useState } from 'react';
import { GoodsShowcase } from './GoodsShowcase';

interface Props {
  onShowToast: (message: string) => void;
}

type MerchCategory = 'qq' | 'official';

export const MerchStudio: React.FC<Props> = ({ onShowToast }) => {
  const [category, setCategory] = useState<MerchCategory>('qq');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="周边分类">
        <button
          type="button"
          role="tab"
          id="merch-tab-qq"
          aria-controls="merch-category-panel"
          aria-selected={category === 'qq'}
          onClick={() => setCategory('qq')}
          className={`min-h-10 rounded-md border-[0.5px] px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[var(--green-8)] focus-visible:outline-offset-2 ${
            category === 'qq'
              ? 'border-[var(--green-8)] bg-[var(--green-3)] text-[var(--green-12)]'
              : 'border-[var(--amber-6)] bg-[var(--amber-2)] text-[var(--gray-11)] hover:bg-[var(--amber-3)]'
          }`}
        >
          QQ人
        </button>
        <button
          type="button"
          role="tab"
          id="merch-tab-official"
          aria-controls="merch-category-panel"
          aria-selected={category === 'official'}
          onClick={() => setCategory('official')}
          className={`min-h-10 rounded-md border-[0.5px] px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[var(--green-8)] focus-visible:outline-offset-2 ${
            category === 'official'
              ? 'border-[var(--green-8)] bg-[var(--green-3)] text-[var(--green-12)]'
              : 'border-[var(--amber-6)] bg-[var(--amber-2)] text-[var(--gray-11)] hover:bg-[var(--amber-3)]'
          }`}
        >
          官方周边合集
        </button>
      </div>
      <div id="merch-category-panel" role="tabpanel" aria-labelledby={category === 'qq' ? 'merch-tab-qq' : 'merch-tab-official'}>
        <GoodsShowcase compact categoryFilter={category} onShowToast={onShowToast} />
      </div>
    </div>
  );
};
