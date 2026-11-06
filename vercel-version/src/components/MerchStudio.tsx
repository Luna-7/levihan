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
          className={`resource-filter-tab min-h-10 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${category === 'qq' ? 'resource-filter-tab--active' : ''}`}
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
          className={`resource-filter-tab min-h-10 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${category === 'official' ? 'resource-filter-tab--active' : ''}`}
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
