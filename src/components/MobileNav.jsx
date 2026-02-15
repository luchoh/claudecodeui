import React, { useCallback } from 'react';
import { MessageSquare, Folder, Terminal, CheckSquare } from 'lucide-react';
import { useTasksSettings } from '../contexts/TasksSettingsContext';

function MobileNav({ activeTab, setActiveTab, isInputFocused }) {
  const { tasksEnabled } = useTasksSettings();
  const navItems = [
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageSquare,
    },
    {
      id: 'shell',
      label: 'Shell',
      icon: Terminal,
    },
    {
      id: 'files',
      label: 'Files',
      icon: Folder,
    },
    // Conditionally add tasks tab if enabled
    ...(tasksEnabled ? [{
      id: 'tasks',
      label: 'Tasks',
      icon: CheckSquare,
    }] : [])
  ];

  const handleTabPress = useCallback((tabId) => {
    setActiveTab(tabId);
  }, [setActiveTab]);

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 bg-background border-t border-border z-[60] ios-bottom-safe transition-transform duration-300 ease-in-out shadow-lg ${
        isInputFocused ? 'translate-y-full' : 'translate-y-0'
      }`}
      role="tablist"
      aria-label="Navigation"
    >
      <div className="flex items-center justify-around py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={isActive}
              aria-label={item.label}
              onClick={() => handleTabPress(item.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1 rounded-lg relative touch-manipulation active:opacity-70 ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileNav;
