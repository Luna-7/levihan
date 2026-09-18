import React from 'react';
import { NavigationTab } from '../types';
import { ImageNavBar } from './ImageNavBar';

interface Props {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
}

export const MobileBottomNav: React.FC<Props> = ({ activeTab, onSelectTab }) => {
  return <ImageNavBar activeTab={activeTab} onSelectTab={onSelectTab} isMobile={true} />;
};

