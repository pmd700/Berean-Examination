import React from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { followLibraryLink } from '@/lib/libraryLinks';

function RoutedLinks({ children }) {
  const navigate = useNavigate();
  return <div style={{ display: 'contents' }} onClickCapture={event => followLibraryLink(event, navigate)}>{children}</div>;
}

/** Saved HTML and Markdown links use the same in-app routes as live editors. */
export default function LibraryLinkBoundary({ children }) {
  const routed = useInRouterContext();
  return routed ? <RoutedLinks>{children}</RoutedLinks> : children;
}
