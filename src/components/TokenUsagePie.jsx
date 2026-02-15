import React from 'react';

function TokenUsagePie({ used, total }) {
  // Token usage visualization component
  // Only bail out on missing values or non‐positive totals; allow used===0 to render 0%
 if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // Color based on usage level
  const getColor = () => {
    if (percentage < 50) return '#3b82f6'; // blue
    if (percentage < 75) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  // Format token count compactly (e.g., 67k/160k)
  const formatTokens = (n) => {
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return n.toString();
  };

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
      title={`Context window: ${used.toLocaleString()} / ${total.toLocaleString()} tokens used (${percentage.toFixed(1)}%)`}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="transform -rotate-90 flex-shrink-0">
        {/* Background circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-300 dark:text-gray-600"
        />
        {/* Progress circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {/* Desktop: "Context: 41.9%" | Mobile: "67k/160k" */}
      <span className="hidden sm:inline text-gray-500 dark:text-gray-400">Context:</span>
      <span className="hidden sm:inline">{percentage.toFixed(1)}%</span>
      <span className="sm:hidden">{formatTokens(used)}/{formatTokens(total)}</span>
    </div>
  );
}

export default TokenUsagePie;
