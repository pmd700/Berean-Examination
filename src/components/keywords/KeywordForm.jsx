import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, X } from 'lucide-react';
import TEXT_EDITOR_MACHINERY from '../editor/TEXT_EDITOR_MACHINERY';

export default function KeywordForm({ isOpen, onClose, keyword, onSave }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (keyword) {
      setTitle(keyword.title || '');
      setCategory(keyword.category || '');
      setExplanation(keyword.explanation || '');
    } else {
      setTitle('');
      setCategory('');
      setExplanation('');
    }
    setErrors({});
  }, [keyword, isOpen]);

  const validate = () => {
    const newErrors = {};
    if (!title.trim()) newErrors.title = 'Title is required';
    if (category.length > 30) newErrors.category = 'Category must be 30 characters or less';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    
    setSaving(true);
    await onSave({
      title: title.trim(),
      category: category.trim(),
      explanation
    });
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 border-purple-200 dark:border-purple-800">
        <DialogHeader>
          <DialogTitle className="text-purple-900 dark:text-purple-100 font-serif text-xl">
            {keyword ? 'Edit Keyword' : 'Create New Keyword'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title" className="text-gray-700 dark:text-gray-300">
              Keyword Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., The Time of Jacob's Trouble"
              className={`dark:bg-gray-800 dark:border-gray-700 ${errors.title ? 'border-red-500' : ''}`}
            />
            {errors.title && <p className="text-red-500 text-sm">{errors.title}</p>}
          </div>

          <div className="space-y-2 w-full max-w-sm">
            <Label htmlFor="category" className="text-gray-700 dark:text-gray-300">
              Category <span className="text-gray-400 text-xs">(optional, max 30 characters)</span>
            </Label>
            <Input
              id="category"
              value={category}
              maxLength={30}
              onChange={(e) => setCategory(e.target.value.slice(0, 30))}
              placeholder="e.g., Eschatology"
              className={`dark:bg-gray-800 dark:border-gray-700 ${errors.category ? 'border-red-500' : ''}`}
            />
            <div className="flex justify-between">
              {errors.category && <p className="text-red-500 text-sm">{errors.category}</p>}
              <p className="text-gray-400 text-xs ml-auto">{category.length}/30</p>
            </div>
          </div>

          <div className="space-y-2 [&_.ProseMirror.bex-block-editor]:!px-10 [&_.ProseMirror.bex-block-editor]:py-6">
            <Label className="text-gray-700 dark:text-gray-300">
              Explanation
            </Label>
            <TEXT_EDITOR_MACHINERY
              content={explanation}
              onChange={setExplanation}
              placeholder="Provide a detailed explanation of this keyword or concept..."
              localFindShortcut
            />
          </div>
        </div>

        <DialogFooter className="gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="dark:border-gray-600">
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={saving}
            className="bg-brand text-white hover:bg-brand-strong"
          >
            <Save className="w-4 h-4 mr-1" />
            {saving ? 'Saving...' : 'Save Keyword'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
