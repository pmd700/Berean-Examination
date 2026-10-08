import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Trash2, Upload, ExternalLink, ImageIcon, ArrowLeft, Loader2, Search } from 'lucide-react';
import { listAssets, uploadAsset, deleteAsset } from '@/lib/assetRegistry';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export default function AssetLibrary({ onBack }) {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [previewAsset, setPreviewAsset] = useState(null);
  const [dimensions, setDimensions] = useState({});

  const canManage = !!user?.is_local_owner;

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/');
      return;
    }
    refresh();
  }, [isLoadingAuth, isAuthenticated]);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await listAssets();
      setAssets(rows);
    } catch (e) {
      toast({ title: 'Could not load library', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let success = 0;
    for (const file of Array.from(files)) {
      try {
        await uploadAsset(file);
        success++;
      } catch (e) {
        toast({ title: `Upload failed: ${file.name}`, description: e.message, variant: 'destructive' });
      }
    }
    setUploading(false);
    if (success > 0) {
      toast({ title: `Uploaded ${success} image${success === 1 ? '' : 's'}` });
      refresh();
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteAsset(target.id);
      setAssets(prev => prev.filter(a => a.id !== target.id));
      if (previewAsset?.id === target.id) setPreviewAsset(null);
      toast({ title: 'Image removed' });
    } catch (e) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  }

  const handleImgLoad = (id, e) => {
    const { naturalWidth, naturalHeight } = e.target;
    setDimensions((prev) =>
      prev[id]?.w === naturalWidth && prev[id]?.h === naturalHeight
        ? prev
        : { ...prev, [id]: { w: naturalWidth, h: naturalHeight } }
    );
  };

  const handleBack = () => {
    if (onBack) onBack();
    else navigate('/');
  };

  const filtered = assets.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto" data-testid="page-asset-library">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          data-testid="button-back"
          className="gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold tracking-wide flex-1" data-testid="text-page-title">
          Asset Library
        </h1>
        {canManage && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
              data-testid="input-upload"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload"
              className="gap-2"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload Images'}
            </Button>
          </>
        )}
      </div>

      <div className="relative mb-6 max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20" data-testid="status-loading">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed rounded-lg py-20 text-center text-muted-foreground" data-testid="status-empty">
          <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>{assets.length === 0 ? 'No images yet.' : 'No images match your search.'}</p>
          {canManage && assets.length === 0 && (
            <p className="text-sm mt-2">Click “Upload Images” to add your first asset.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(asset => (
            <div
              key={asset.id}
              className="group relative border rounded-lg overflow-hidden bg-card card-metal"
              data-testid={`card-asset-${asset.id}`}
            >
              <button
                type="button"
                onClick={() => setPreviewAsset(asset)}
                className="block aspect-square bg-black/30"
                data-testid={`button-preview-asset-${asset.id}`}
              >
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  data-testid={`img-asset-${asset.id}`}
                  onLoad={(e) => handleImgLoad(asset.id, e)}
                />
              </button>
              <div className="p-2 text-xs">
                <div className="truncate" title={asset.name} data-testid={`text-name-${asset.id}`}>
                  {asset.name}
                </div>
                <p
                  className="mt-0.5 text-[10px] font-mono text-muted-foreground"
                  data-testid={`text-asset-dimensions-${asset.id}`}
                >
                  {dimensions[asset.id]
                    ? `${dimensions[asset.id].w} × ${dimensions[asset.id].h} px`
                    : 'Loading dimensions…'}
                </p>
                <div className="flex items-center justify-between mt-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewAsset(asset)}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    data-testid={`button-open-${asset.id}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open
                  </button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setPendingDelete(asset)}
                      data-testid={`button-delete-${asset.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this image?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name} will be removed from the library and the file deleted from storage.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!previewAsset} onOpenChange={(open) => !open && setPreviewAsset(null)}>
        <DialogContent className="max-w-5xl border-white/10 bg-app p-4">
          <DialogTitle className="truncate pr-8 text-sm text-white">
            {previewAsset?.name}
          </DialogTitle>
          {previewAsset && (
            <div className="flex max-h-[80vh] items-center justify-center overflow-hidden rounded-xl bg-black/40">
              <img
                src={previewAsset.url}
                alt={previewAsset.name}
                className="max-h-[78vh] max-w-full object-contain"
                data-testid="image-asset-preview"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
