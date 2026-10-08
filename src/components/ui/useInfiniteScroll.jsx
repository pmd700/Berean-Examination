import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for infinite scrolling with accessibility
 * @param {Array} allItems - Full array of items to paginate
 * @param {number} itemsPerPage - Number of items to load per page
 */
export function useInfiniteScroll(allItems = [], itemsPerPage = 20) {
  const [displayedItems, setDisplayedItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = useRef(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const pageRef = useRef(1);
  const allItemsRef = useRef([]);
  const needsInit = useRef(true);

  // Keep hasMore ref in sync so the observer callback always sees the latest value
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Reset when allItems actually changes (compare by value, not just reference)
  useEffect(() => {
    const prevItems = allItemsRef.current;
    const changed = allItems.length !== prevItems.length ||
      allItems.some((item, i) => item !== prevItems[i]);
    if (needsInit.current || changed) {
      needsInit.current = false;
      allItemsRef.current = allItems;
      const initialItems = allItems.slice(0, itemsPerPage);
      setDisplayedItems(initialItems);
      setPage(1);
      pageRef.current = 1;
      setHasMore(allItems.length > itemsPerPage);
      hasMoreRef.current = allItems.length > itemsPerPage;
      loadingRef.current = false;
    }
  }, [allItems, itemsPerPage]);

  // Load more items — reads mutable refs so it doesn't depend on hasMore / page state
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;

    setTimeout(() => {
      const nextPage = pageRef.current + 1;
      const startIndex = pageRef.current * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const newItems = allItems.slice(startIndex, endIndex);

      if (newItems.length > 0) {
        setDisplayedItems(prev => [...prev, ...newItems]);
        setPage(nextPage);
        pageRef.current = nextPage;
        const stillHasMore = endIndex < allItems.length;
        setHasMore(stillHasMore);
      } else {
        setHasMore(false);
      }

      loadingRef.current = false;
    }, 100);
  }, [allItems, itemsPerPage]);

  // Intersection Observer — only recreates when loadMore changes (allItems / itemsPerPage)
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [loadMore]);

  return {
    displayedItems,
    hasMore,
    isLoading: loadingRef.current,
    observerTarget,
    loadMore
  };
}