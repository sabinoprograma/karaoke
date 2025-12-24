import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Play,
  Heart,
  History as HistoryIcon,
  Music,
  ChevronLeft,
  Moon,
  Sun,
  Star,
  Mic2,
  AlertCircle,
  Loader2,
  Disc,
  ListMusic
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'firebase/auth';

// Firebase configuration from environment variables
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'yt-karaoke-app';

// POOL DE LLAVES: Pon llaves de DIFERENTES PROYECTOS aquí para sumar cuota.
// Si son del mismo proyecto, comparten el límite de 10,000.
const KEY_POOL = [
  "AIzaSyDP-tY6gBxMeblf-IwGgi2JQ_qJLuAdEzQ",
  "AIzaSyAhIcF9_zmAOI7hGRlw8XyFJ0MxNstaA9s",
  "AIzaSyBfLdh43TglELfag6LOWrRMh0UXvaDRP-4"
].map(k => k.trim()); // Limpia espacios accidentales

const CACHE_DURATION = 1000 * 60 * 60 * 2; // 2 horas de caché
const CACHE_PREFIX = 'yt_karaoke_v1_';

const getCachedData = (key) => {
  try {
    const item = localStorage.getItem(CACHE_PREFIX + key);
    if (!item) return null;
    const parsed = JSON.parse(item);
    if (Date.now() > parsed.expiry) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch (e) { return null; }
};

const setCachedData = (key, data) => {
  try {
    const item = {
      data,
      expiry: Date.now() + CACHE_DURATION
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(item));
  } catch (e) {
    // Si falla por espacio, limpiamos todo el caché
    localStorage.clear();
  }
};

const CATEGORIES = [
  { id: 'trending_ar', name: 'Hits Argentina', icon: <Star className="w-4 h-4" />, query: 'karaoke exitos actuales argentina 2024 2025' },
  { id: 'rock', name: 'Rock Nacional', icon: <Music className="w-4 h-4" />, query: 'karaoke rock nacional argentino clasicos' },
  { id: 'cumbia_nueva', name: 'Cumbia RKT', icon: <Disc className="w-4 h-4" />, query: 'karaoke cumbia rkt 2024' },
  { id: 'cuarteto', name: 'Cuarteto Cordobés', icon: <Disc className="w-4 h-4" />, query: 'karaoke cuarteto cordobes la konga ulises bueno' },
  { id: 'trap_ar', name: 'Trap / Urbano AR', icon: <Mic2 className="w-4 h-4" />, query: 'karaoke trap argentino duki tiago pzk emilia bizarrap' },
  { id: 'cumbia_90', name: 'Cumbia 90s/00s', icon: <Disc className="w-4 h-4" />, query: 'karaoke cumbia vieja clasicos 90 2000' },
  { id: 'folklore', name: 'Folklore', icon: <Music className="w-4 h-4" />, query: 'karaoke folklore argentino grandes exitos' },
  { id: '80_90_latino', name: 'Clásicos 80/90', icon: <HistoryIcon className="w-4 h-4" />, query: 'karaoke clasicos 80 90 español latino' },
  { id: 'baladas', name: 'Baladas', icon: <Heart className="w-4 h-4" />, query: 'karaoke baladas romanticas español luis miguel' },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [darkMode, setDarkMode] = useState(true);
  const [view, setView] = useState('home');
  const [error, setError] = useState(null);
  const [currentKeyIndex, setCurrentKeyIndex] = useState(0);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Error de autenticación inicial:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const favsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'favorites');
    const histRef = collection(db, 'artifacts', appId, 'users', user.uid, 'history');

    const unsubFavs = onSnapshot(favsRef, (snapshot) => {
      setFavorites(snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        videoId: doc.data().videoId || doc.id
      })));
    }, (err) => console.error("Error en tiempo real favoritos:", err));

    const unsubHist = onSnapshot(histRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    }, () => { });

    return () => { unsubFavs(); unsubHist(); };
  }, [user, appId]);

  const fetchDynamicVideos = async (queryText, isLoadMore = false, forceKeyIndex = null) => {
    const cacheKey = `${queryText}_${isLoadMore ? nextPageToken : 'first'}`;
    let keyIdx = forceKeyIndex !== null ? forceKeyIndex : currentKeyIndex;

    // Si estamos rotando y volvimos al inicio, ya no hay más llaves que probar
    if (forceKeyIndex !== null && forceKeyIndex === currentKeyIndex && keyIdx !== 0) { // Added keyIdx !== 0 to allow initial attempt with first key
      setError("Todas las API Keys han agotado su cuota para hoy.");
      setLoading(false); // Ensure loading is false if all keys fail
      setIsFetchingMore(false); // Ensure fetching is false if all keys fail
      return;
    }

    if (isLoadMore) {
      if (!nextPageToken || isFetchingMore) return;
      setIsFetchingMore(true);
    } else {
      setLoading(true);
      setError(null);
      setNextPageToken(null);

      const cached = getCachedData(cacheKey);
      if (cached) {
        setVideos(cached.videos);
        setNextPageToken(cached.nextPageToken);
        setLoading(false);
        return;
      }
    }

    const currentKey = KEY_POOL[keyIdx];
    const encodedQuery = encodeURIComponent(queryText + " karaoke");
    const tokenParam = isLoadMore && nextPageToken ? `&pageToken=${nextPageToken}` : '';
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=12&q=${encodedQuery}&type=video&videoEmbeddable=true&key=${currentKey}${tokenParam}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        const reason = errorData.error?.errors?.[0]?.reason;

        // ROTACIÓN DE LLAVE: Funciona tanto si se agota la cuota como si la llave es inválida
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'keyInvalid') {
          const nextIdx = (keyIdx + 1) % KEY_POOL.length;
          console.warn(`Problema con llave ${keyIdx} (${reason}). Rotando a llave ${nextIdx}...`);
          setCurrentKeyIndex(nextIdx); // Guardamos el cambio globalmente
          // Reintentamos la misma función con la nueva llave
          return fetchDynamicVideos(queryText, isLoadMore, nextIdx);
        }

        throw new Error(errorData.error?.message || 'error en la api de youtube');
      }
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const processed = data.items.map(item => ({
          videoId: item.id.videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
          genre: activeCategory.name
        }));

        const newVideos = isLoadMore ? [...videos, ...processed] : processed;

        setVideos(prev => {
          if (!isLoadMore) return processed;
          const existingIds = new Set(prev.map(v => v.videoId));
          const uniqueNewVideos = processed.filter(v => !existingIds.has(v.videoId));
          return [...prev, ...uniqueNewVideos];
        });

        setNextPageToken(data.nextPageToken || null);

        // Guardar en caché (solo para la primera página o búsquedas frecuentes)
        if (!isLoadMore) {
          setCachedData(cacheKey, {
            videos: processed,
            nextPageToken: data.nextPageToken
          });
        }
      } else {
        if (!isLoadMore) throw new Error('no se encontraron resultados');
      }
    } catch (err) {
      if (!isLoadMore) setError(err.message);
    } finally {
      if (isLoadMore) setIsFetchingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    if (!searchQuery) {
      fetchDynamicVideos(activeCategory.query, false, 'CATEGORIES');
    }
  }, [activeCategory]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      fetchDynamicVideos(searchQuery, false, 'SEARCH');
      setView('home');
    }
  };

  const handleLoadMore = () => {
    if (nextPageToken && !isFetchingMore) {
      fetchDynamicVideos(searchQuery || activeCategory.query, true);
    }
  };

  const playVideo = async (video) => {
    setCurrentVideo(video);
    setView('player');
    if (user) {
      try {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'history'), {
          ...video,
          timestamp: serverTimestamp()
        });
      } catch (e) {
        console.error("error en historial:", e);
      }
    }
  };

  const toggleFavorite = async (video) => {
    if (!user) {
      console.warn("Inicie sesión para guardar favoritos");
      return;
    }
    try {
      const videoId = video.videoId;
      const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'favorites', videoId);
      const exists = favorites.find(f => f.videoId === videoId || f.id === videoId);

      if (exists) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, {
          ...video,
          addedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.error("Error al modificar favoritos:", e);
    }
  };

  const clearHistory = async () => {
    if (!user) return;
    history.forEach(h => deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'history', h.id)));
  };

  const renderVideoCard = (video, idx) => {
    const isFav = favorites.some(f => f.videoId === video.videoId || f.id === video.videoId);
    const thumb = video.thumbnail;

    return (
      <div
        key={`${video.videoId}-${idx}`}
        className={`group relative rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${darkMode ? 'bg-zinc-900 border border-zinc-800' : 'bg-white shadow-md border border-zinc-100'
          }`}
      >
        <div className="relative aspect-video cursor-pointer bg-zinc-800" onClick={() => playVideo(video)}>
          <img
            src={thumb}
            alt={video.title}
            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
            loading="lazy"
            onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=500&q=60'; }}
          />
          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <div className="w-12 h-12 bg-rose-600 rounded-full flex items-center justify-center shadow-lg scale-90 group-hover:scale-110 transition-transform">
              <Play className="w-6 h-6 text-white fill-current ml-1" />
            </div>
          </div>
        </div>
        <div className="p-4">
          <h3 className={`text-sm font-bold line-clamp-2 mb-2 leading-tight ${darkMode ? 'text-zinc-100' : 'text-zinc-800'}`} dangerouslySetInnerHTML={{ __html: video.title }}></h3>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-500/10 px-2 py-1 rounded truncate max-w-[120px]">
              {video.channelTitle}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleFavorite(video);
              }}
              className={`relative z-20 p-2 rounded-full transition-all duration-200 transform hover:scale-110 active:scale-90 ${isFav
                ? 'text-rose-500 bg-rose-500/10 shadow-inner'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-rose-500 dark:hover:bg-zinc-800'
                }`}
            >
              <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-black text-zinc-100' : 'bg-slate-50 text-slate-900'}`}>

      <header className={`sticky top-0 z-50 px-4 py-3 border-b backdrop-blur-xl supports-[backdrop-filter]:bg-opacity-80 ${darkMode ? 'bg-black/80 border-zinc-800' : 'bg-white/80 border-slate-200'
        }`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => { setView('home'); setSearchQuery(''); setActiveCategory(CATEGORIES[0]); }}>
            <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-orange-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-rose-500/20 group-hover:scale-105 transition-transform">
              <Mic2 className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-black tracking-tighter hidden sm:block italic bg-clip-text text-transparent bg-gradient-to-r from-rose-500 to-orange-500">
              YT-KARAOKE
            </h1>
          </div>

          <form onSubmit={handleSearch} className="flex-1 max-w-lg relative group">
            <input
              type="text"
              placeholder="buscar karaoke en youtube..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-2.5 rounded-xl outline-none transition-all border ${darkMode
                ? 'bg-zinc-900 border-zinc-800 focus:border-rose-500 focus:bg-zinc-800'
                : 'bg-white border-slate-200 focus:border-rose-500 focus:shadow-md'
                }`}
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-rose-500 transition-colors" />
          </form>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2.5 rounded-xl transition-colors ${darkMode ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-100 text-slate-600'}`}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="hidden sm:flex gap-1 pl-2 border-l border-zinc-800/50">
              <button
                onClick={() => setView('favorites')}
                className={`relative p-2.5 rounded-xl transition-colors ${view === 'favorites' ? 'text-rose-500 bg-rose-500/10' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
              >
                <Heart className="w-5 h-5" />
                {favorites.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full border-2 border-black animate-pulse"></span>
                )}
              </button>
              <button onClick={() => setView('history')} className={`p-2.5 rounded-xl transition-colors ${view === 'history' ? 'text-rose-500 bg-rose-500/10' : 'text-zinc-400 hover:bg-zinc-800/50'}`}>
                <HistoryIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {view === 'home' && (
        <nav className={`py-2 px-4 border-b overflow-x-auto no-scrollbar ${darkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200'}`}>
          <div className="max-w-7xl mx-auto flex items-center gap-2 min-w-max">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setActiveCategory(cat); setSearchQuery(''); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${activeCategory.id === cat.id
                  ? 'bg-zinc-100 text-black shadow-sm scale-105'
                  : (darkMode ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100')
                  }`}
              >
                {cat.icon}
                {cat.name}
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 mb-20 sm:mb-8">

        {view === 'player' && currentVideo && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <button
              onClick={() => setView('home')}
              className="flex items-center gap-2 text-zinc-500 hover:text-rose-500 text-sm font-bold mb-6 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              VOLVER A LISTA
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-4">
                <div className="aspect-video w-full rounded-2xl overflow-hidden shadow-2xl bg-black ring-1 ring-white/10">
                  <iframe
                    src={`https://www.youtube.com/embed/${currentVideo.videoId}?autoplay=1&rel=0`}
                    title={currentVideo.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black leading-tight mb-1" dangerouslySetInnerHTML={{ __html: currentVideo.title }}></h2>
                    <p className="text-zinc-500 text-sm font-medium uppercase tracking-tighter">{currentVideo.channelTitle}</p>
                  </div>
                  <button
                    onClick={() => toggleFavorite(currentVideo)}
                    className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${favorites.some(f => f.videoId === currentVideo.videoId || f.id === currentVideo.videoId)
                      ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                  >
                    <Heart className={`w-4 h-4 ${favorites.some(f => f.videoId === currentVideo.videoId || f.id === currentVideo.videoId) ? 'fill-current' : ''}`} />
                    {favorites.some(f => f.videoId === currentVideo.videoId || f.id === currentVideo.videoId) ? 'GUARDADO' : 'FAVORITOS'}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-2">
                  <ListMusic className="w-4 h-4" />
                  Sugerencias
                </h3>
                <div className="space-y-3">
                  {videos
                    .filter(v => v.videoId !== currentVideo.videoId)
                    .slice(0, 5)
                    .map((video, idx) => (
                      <div
                        key={idx}
                        onClick={() => playVideo(video)}
                        className={`flex gap-3 p-2 rounded-xl cursor-pointer transition-colors ${darkMode ? 'hover:bg-zinc-900' : 'hover:bg-slate-100'}`}
                      >
                        <div className="w-24 aspect-video rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0 relative">
                          <img src={video.thumbnail} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <h4 className={`text-xs font-bold line-clamp-2 leading-tight mb-1 ${darkMode ? 'text-zinc-200' : 'text-slate-800'}`} dangerouslySetInnerHTML={{ __html: video.title }}></h4>
                          <p className="text-[10px] text-zinc-500 uppercase truncate">{video.channelTitle}</p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'home' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-black tracking-tight uppercase">
                  {searchQuery ? `resultados: ${searchQuery}` : activeCategory.name}
                </h2>
                <p className="text-xs text-zinc-500 font-medium mt-1">
                  {loading ? 'obteniendo videos de youtube...' : `listo para cantar`}
                </p>
              </div>
              {loading && <Loader2 className="w-5 h-5 text-rose-500 animate-spin" />}
            </div>

            {error && (
              <div className="mb-8 p-6 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex flex-col items-center gap-3 text-rose-500 text-center">
                <AlertCircle className="w-8 h-8" />
                <div>
                  <p className="font-black uppercase tracking-tighter">error en la busqueda</p>
                  <p className="opacity-80 text-xs mt-1">{error}</p>
                </div>
                <button
                  onClick={() => searchQuery ? fetchDynamicVideos(searchQuery) : fetchDynamicVideos(activeCategory.query)}
                  className="mt-2 px-6 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold"
                >
                  reintentar
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {loading && videos.length === 0 ? (
                [...Array(8)].map((_, i) => (
                  <div key={i} className="animate-pulse space-y-3">
                    <div className="aspect-video bg-zinc-800/50 rounded-2xl"></div>
                    <div className="h-4 bg-zinc-800/50 rounded-lg w-3/4"></div>
                    <div className="h-3 bg-zinc-800/50 rounded-lg w-1/2"></div>
                  </div>
                ))
              ) : (
                videos.map(renderVideoCard)
              )}
            </div>

            {/* Botón manual de Carga para cuidar la cuota */}
            {!loading && nextPageToken && (
              <div className="flex justify-center mt-12 mb-8">
                <button
                  onClick={handleLoadMore}
                  disabled={isFetchingMore}
                  className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all transform active:scale-95 ${isFetchingMore
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700 hover:text-white shadow-lg'
                    }`}
                >
                  {isFetchingMore ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      CARGANDO...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 rotate-90" />
                      VER MÁS RESULTADOS
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {(view === 'favorites' || view === 'history') && (
          <div className="animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-black flex items-center gap-3 uppercase">
                {view === 'favorites' ? <Heart className="w-6 h-6 text-rose-500" /> : <HistoryIcon className="w-6 h-6 text-rose-500" />}
                {view === 'favorites' ? 'tus favoritos' : 'historial'}
              </h2>
              {view === 'history' && history.length > 0 && (
                <button onClick={clearHistory} className="text-xs font-bold text-zinc-500 hover:text-rose-500 uppercase">limpiar</button>
              )}
            </div>

            {(view === 'favorites' ? favorites : history).length === 0 ? (
              <div className="text-center py-20 bg-zinc-900/20 rounded-3xl border-2 border-zinc-900/50 border-dashed">
                <p className="text-zinc-500 font-medium">no hay canciones aqui</p>
                <button onClick={() => setView('home')} className="mt-4 text-rose-500 text-xs font-black uppercase hover:underline">explorar</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {(view === 'favorites' ? favorites : history).map(renderVideoCard)}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className={`fixed bottom-0 left-0 right-0 z-50 md:hidden border-t px-6 py-3 flex justify-around items-center ${darkMode ? 'bg-black/95 border-zinc-800' : 'bg-white/95 border-slate-200'
        } backdrop-blur-lg`}>
        <button onClick={() => { setView('home'); setSearchQuery(''); }} className={`flex flex-col items-center gap-1 transition-colors ${view === 'home' ? 'text-rose-500' : 'text-zinc-600'}`}>
          <Play className="w-5 h-5" />
          <span className="text-[10px] font-bold">Inicio</span>
        </button>
        <button onClick={() => setView('favorites')} className={`flex flex-col items-center gap-1 transition-colors ${view === 'favorites' ? 'text-rose-500' : 'text-zinc-600'}`}>
          <Heart className="w-5 h-5" />
          <span className="text-[10px] font-bold">Favs</span>
        </button>
        <button onClick={() => setView('history')} className={`flex flex-col items-center gap-1 transition-colors ${view === 'history' ? 'text-rose-500' : 'text-zinc-600'}`}>
          <HistoryIcon className="w-5 h-5" />
          <span className="text-[10px] font-bold">Historial</span>
        </button>
      </footer>
    </div>
  );
}
