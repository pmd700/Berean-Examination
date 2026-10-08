import React, { useId, useState } from 'react';

export default function ExternalWebLink({
  href,
  children,
  className = '',
  ...props
}) {
  const [error, setError] = useState('');
  const errorId = `external-link-error-${useId()}`;

  const handleClick = async (event) => {
    const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
    if (!desktopApi?.isDesktop || typeof desktopApi.openExternalUrl !== 'function') return;

    event.preventDefault();
    setError('');
    try {
      const result = await desktopApi.openExternalUrl(href);
      if (!result?.ok) throw new Error(result?.error || 'BEX could not open that page.');
    } catch (linkError) {
      setError(linkError?.message || 'BEX could not open that page.');
    }
  };

  return (
    <>
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        aria-describedby={error ? errorId : undefined}
        className={className}
      >
        {children}
      </a>
      {error && (
        <span id={errorId} role="alert" className="text-xs text-rose-400">
          {error}
        </span>
      )}
    </>
  );
}
