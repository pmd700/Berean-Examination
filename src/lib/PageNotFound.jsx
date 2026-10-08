import { useLocation } from 'react-router-dom';
import { desktopClient } from '@/api/desktopClient';
import { useQuery } from '@tanstack/react-query';


export default function PageNotFound({}) {
    const location = useLocation();
    const pageName = location.pathname.substring(1);

    const { data: authData, isFetched } = useQuery({
        queryKey: ['user'],
        queryFn: async () => {
            try {
                const user = await desktopClient.owner.read();
                return { user, isAuthenticated: true };
            } catch (error) {
                return { user: null, isAuthenticated: false };
            }
        }
    });
    
    return (
        <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
            {/* Fully local background: no cloud image is required. */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: 'radial-gradient(circle at 25% 20%, rgba(124, 92, 183, 0.28), transparent 36%), radial-gradient(circle at 78% 74%, rgba(90, 62, 135, 0.2), transparent 34%), linear-gradient(145deg, #070911 0%, #111522 58%, #080a10 100%)'
                }}
            >
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/50 to-black/40"></div>
            </div>
            
            {/* Content */}
            <div className="relative z-10 max-w-2xl w-full px-6">
                <div className="text-center space-y-6">
                    {/* 404 Error Code */}
                    <div className="space-y-4">
                        <h1 className="text-9xl font-serif font-bold text-ink drop-shadow-2xl">404</h1>
                        <p className="text-xl font-serif text-ink-muted/90 italic">
                            not even the Berean's could find that reference
                        </p>
                    </div>
                    
                    {/* Page Name */}
                    <div className="pt-4">
                        <p className="text-ink-faint leading-relaxed">
                            The page <span className="font-medium text-ink-muted">"{pageName}"</span> could not be found
                        </p>
                    </div>
                    
                    {/* Action Button */}
                    <div className="pt-6">
                        <button 
                            onClick={() => window.location.href = '/'} 
                            className="inline-flex items-center px-6 py-3 text-sm font-medium text-ink bg-gradient-to-r from-[#5A3E87] to-[#5A3E87] hover:from-brand hover:to-brand-strong rounded-lg shadow-lg transition-all duration-200"
                        >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                            Return Home
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
