import React from 'react';

const logoPath = '/logo.png';

export function LoadingScreen({ message = 'Loading...', fullScreen = true }) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative">
        <div className="absolute inset-0 animate-ping">
          <div className="w-16 h-16 rounded-full bg-violet-500/10" />
        </div>
        <div className="relative p-4 rounded-lg bg-elevated border border-line shadow-lg">
          <img src={logoPath} alt="" className="w-8 h-8 object-contain animate-pulse" />
        </div>
      </div>
      
      <div className="text-center space-y-2">
        <p className="text-sm font-medium text-ink-muted animate-pulse">
          {message}
        </p>
        <div className="flex gap-1 justify-center">
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-app flex items-center justify-center z-50 transition-colors duration-300">
        {content}
      </div>
    );
  }

  return (
    <div className="w-full min-h-[400px] flex items-center justify-center">
      {content}
    </div>
  );
}

export function LoadingSpinner({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <div className={`${sizeClasses[size]} relative`}>
        <div className="absolute inset-0 border-2 border-line rounded-full" />
        <div className="absolute inset-0 border-2 border-transparent border-t-brand rounded-full animate-spin" />
      </div>
    </div>
  );
}
