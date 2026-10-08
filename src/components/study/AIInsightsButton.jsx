import React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ONLINE_MODE_REQUIRED_MESSAGE } from '@/lib/onlineMode';

export default function AIInsightsButton() {
  return (
    <Button
      type="button"
      variant="outline"
      disabled
      title="AI Insights will become available only when optional Online Mode is built and enabled."
      className="border-gray-700 text-gray-500"
    >
      <Sparkles className="mr-2 h-4 w-4" />
      AI Insights · {ONLINE_MODE_REQUIRED_MESSAGE}
    </Button>
  );
}
