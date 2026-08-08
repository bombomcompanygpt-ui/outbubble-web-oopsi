import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageCircle, Heart, Trash2, X, Send, Image as ImageIcon, 
  Sparkles, Shield, Compass, Smile, Search, 
  Repeat2, Filter, Flame, Share2, 
  Eye, CheckCircle2, Info, MessageSquare, Users, Radio, Hash, Volume2
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';
import { db, collection, onSnapshot, setDoc, doc } from '../lib/firebase';

// Curious Pseudonyms for high-quality Indonesian cyber discussions
const PSEUDONYMS = [
  "Bebas_Gelembung 🫧",
  "Pendeteksi_Bias 🧠",
  "Ksatria_Nalar 🛡️",
  "Socrates_Digital 🔬",
  "Penembak_Hoaks 🎯",
  "Logika_Murni ⚖️",
  "Skeptis_Mapan 🔍",
  "Pecah_Opini ✨",
  "Anti_EchoChamber 📢",
  "Sobat_Sadar 💡",
  "Akademis_Kritis 🎓",
  "Komentator_Arif 🌟"
];

// Live Chat Channels
const CHAT_CHANNELS = [
  { id: 'obrolan-santai', name: 'Obrolan Santai', icon: '💬', desc: 'Obrolan umum & kenalan sesama warga OutBubble' },
  { id: 'literasi-digital', name: 'Literasi & Hoaks', icon: '🛡️', desc: 'Tips cek fakta, jebakan algoritma & hoaks' },
  { id: 'luar-gelembung', name: 'Luar Gelembung', icon: '🚀', desc: 'Tukar pandangan & perspektif beda sudut pandang' },
  { id: 'tanya-jawab', name: 'Tanya & Jawab', icon: '💡', desc: 'Tanya saran, bantuan & panduan fitur' },
];

const EMOJI_LIST = ["😊", "👍", "❤️", "🔥", "💡", "🎉", "🫧", "🤔", "👏", "🙌", "💯", "🎯"];

interface ChatMessage {
  id: string;
  channel: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  image?: string;
  timestamp: number;
  reactions?: Record<string, number>;
}

const Forum: React.FC = () => {
  const { user, openAuthModal } = useStore();
  
  // Tab Mode: 'chat' (Live Community Chat) or 'threads' (Topic Feed)
  const [activeTab, setActiveTab] = useState<'chat' | 'threads'>('chat');
  const [selectedChannel, setSelectedChannel] = useState<string>('obrolan-santai');
  
  // Live Chat States
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatImagePreview, setChatImagePreview] = useState<string | null>(null);
  const [showChatEmojiPicker, setShowChatEmojiPicker] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Forum Threads States
  const [topics, setTopics] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLensFilter, setActiveLensFilter] = useState<string>('Semua');
  const [newPostContent, setNewPostContent] = useState('');
  const [postImagePreview, setPostImagePreview] = useState<string | null>(null);
  const [selectedLens, setSelectedLens] = useState<string>('Opini');
  const [useRealName, setUseRealName] = useState(false);
  const [customPseudonym, setCustomPseudonym] = useState(PSEUDONYMS[0]);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [replyInputMap, setReplyInputMap] = useState<Record<string, string>>({});
  const postFileInputRef = useRef<HTMLInputElement>(null);

  // Citizen & Visitors Stats
  const [onlineCount, setOnlineCount] = useState<number>(1);
  const [totalVisitors, setTotalVisitors] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Audio SFX
  const playPopSound = () => {
    try {
      if (typeof window !== 'undefined') {
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-400.wav");
        audio.volume = 0.2;
        audio.play().catch(() => {});
      }
    } catch (e) {}
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2800);
  };

  // Heartbeat & visitor ping
  useEffect(() => {
    let vid = localStorage.getItem('outbubble_visitor_id');
    if (!vid) {
      vid = `vid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem('outbubble_visitor_id', vid);
    }

    const isNewVisit = !sessionStorage.getItem('outbubble_session_logged');
    if (isNewVisit) {
      sessionStorage.setItem('outbubble_session_logged', 'true');
    }

    const pingVisitor = () => {
      fetch("/api/forum/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: vid, isNewVisit: isNewVisit && !totalVisitors })
      })
        .then(res => res.json())
        .then(data => {
          if (data.onlineCount !== undefined) setOnlineCount(data.onlineCount);
          if (data.totalVisitors !== undefined) setTotalVisitors(data.totalVisitors);
        })
        .catch(() => {});
    };

    pingVisitor();
    const interval = setInterval(pingVisitor, 12000);
    return () => clearInterval(interval);
  }, [totalVisitors]);

  // Fetch Live Chat Messages for current channel
  const fetchChatMessages = async () => {
    try {
      const res = await fetch(`/api/forum/chat/messages?channel=${selectedChannel}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setChatMessages(data);
        }
      }
    } catch (e) {}
  };

  // Fetch Forum Topics
  const fetchTopics = async () => {
    try {
      const res = await fetch('/api/forum/topics');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTopics(data);
        }
      }
    } catch (e) {}
  };

  // Real-time Firestore Sync & Auto-polling interval
  useEffect(() => {
    let unsubscribeChat: (() => void) | null = null;
    let unsubscribeTopics: (() => void) | null = null;

    // 1. Live Chat real-time listener from Firestore
    try {
      const chatRef = collection(db, "chat_messages");
      unsubscribeChat = onSnapshot(chatRef, (snapshot) => {
        const msgs: ChatMessage[] = [];
        snapshot.forEach((d) => {
          msgs.push(d.data() as ChatMessage);
        });
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (msgs.length > 0) {
          const filtered = msgs.filter(m => m.channel === selectedChannel);
          setChatMessages(filtered);
        }
      }, () => {
        fetchChatMessages();
      });
    } catch (e) {
      fetchChatMessages();
    }

    // 2. Live Forum Topics real-time listener from Firestore
    try {
      const topicsRef = collection(db, "topics");
      unsubscribeTopics = onSnapshot(topicsRef, (snapshot) => {
        const tList: any[] = [];
        snapshot.forEach((d) => {
          tList.push(d.data());
        });
        tList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (tList.length > 0) {
          setTopics(tList);
        }
      }, () => {
        fetchTopics();
      });
    } catch (e) {
      fetchTopics();
    }

    // Initial fetch backup
    fetchChatMessages();
    fetchTopics();

    // 3. Periodic polling every 2 seconds for redundancy
    const poll = setInterval(() => {
      fetchChatMessages();
      fetchTopics();
    }, 2000);

    return () => {
      if (unsubscribeChat) unsubscribeChat();
      if (unsubscribeTopics) unsubscribeTopics();
      clearInterval(poll);
    };
  }, [selectedChannel]);

  // Scroll to bottom of chat on new messages
  useEffect(() => {
    if (activeTab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, activeTab]);

  // Handle Send Chat Message
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() && !chatImagePreview) return;

    playPopSound();

    const authorName = (user && !user.isGuest && user.username) ? user.username : customPseudonym;
    const authorAvatar = (user && !user.isGuest && user.photoUrl) ? user.photoUrl : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorName)}`;

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newMsgObj: ChatMessage = {
      id: msgId,
      channel: selectedChannel,
      authorId: user?.id || 'guest-anon',
      authorName,
      authorAvatar,
      content: chatInput.trim(),
      image: chatImagePreview || undefined,
      timestamp: Date.now(),
      reactions: {}
    };

    // Optimistic UI insert
    setChatMessages(prev => [...prev.filter(m => m.id !== msgId), newMsgObj]);

    setChatInput('');
    setChatImagePreview(null);
    setShowChatEmojiPicker(false);

    // 1. Direct Firestore write
    try {
      await setDoc(doc(db, "chat_messages", msgId), newMsgObj);
    } catch (e) {}

    // 2. Server API sync backup
    try {
      await fetch('/api/forum/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMsgObj)
      });
      fetchChatMessages();
    } catch (e) {
      triggerToast("Gagal mengirim pesan chat");
    }
  };

  // Handle React to Chat Message
  const handleReactChatMessage = async (messageId: string, emoji: string) => {
    playPopSound();

    try {
      await fetch(`/api/forum/chat/messages/${messageId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
      });
      fetchChatMessages();
    } catch (e) {}
  };

  // Delete Chat Message
  const handleDeleteChatMessage = async (id: string) => {
    try {
      await fetch(`/api/forum/chat/messages/${id}`, { method: 'DELETE' });
      fetchChatMessages();
      triggerToast("Pesan berhasil dihapus");
    } catch (e) {}
  };

  // Post image handler
  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) {
        triggerToast("Ukuran foto maksimal 4MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setChatImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Create new Forum Topic
  const handleCreateTopic = async () => {
    if (!newPostContent.trim() && !postImagePreview) return;

    playPopSound();

    const authorName = useRealName
      ? ((user && !user.isGuest && user.username) ? user.username : 'Warga OutBubble 🫧')
      : customPseudonym;

    const authorAvatar = useRealName 
      ? ((user && !user.isGuest && user.photoUrl) ? user.photoUrl : `https://api.dicebear.com/7.x/avataaars/svg?seed=Guest`)
      : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(customPseudonym)}`;

    const topicId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTopicObj = {
      id: topicId,
      authorId: user?.id || 'guest-anon',
      authorName,
      authorAvatar,
      content: newPostContent.trim(),
      image: postImagePreview || undefined,
      lens: selectedLens,
      likes: 0,
      repliesCount: 0,
      replies: [],
      repostsCount: 0,
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    };

    setTopics(prev => [newTopicObj, ...prev.filter(t => t.id !== topicId)]);

    setNewPostContent('');
    setPostImagePreview(null);

    // 1. Direct Firestore write
    try {
      await setDoc(doc(db, "topics", topicId), newTopicObj);
    } catch (e) {}

    // 2. Server API write
    try {
      const res = await fetch('/api/forum/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTopicObj)
      });
      if (res.ok) {
        fetchTopics();
        triggerToast("Pendapat/Diskusi baru berhasil dipublikasikan ke seluruh warga! 🎉");
      }
    } catch (e) {
      triggerToast("Gagal memposting diskusi");
    }
  };

  // Like topic
  const handleLikeTopic = async (topicId: string, currentLikes: number) => {
    playPopSound();
    try {
      await fetch(`/api/forum/topics/${topicId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLikedByMe: false })
      });
      fetchTopics();
    } catch (e) {}
  };

  // Repost topic
  const handleRepostTopic = async (topicId: string) => {
    playPopSound();
    try {
      await fetch(`/api/forum/topics/${topicId}/repost`, { method: 'POST' });
      fetchTopics();
      triggerToast("Topik berhasil dibagikan ulang!");
    } catch (e) {}
  };

  // Send Reply
  const handleSendReply = async (topicId: string) => {
    const replyText = replyInputMap[topicId] || '';
    if (!replyText.trim()) return;

    playPopSound();

    const authorName = (user && !user.isGuest && user.username) ? user.username : customPseudonym;

    try {
      await fetch(`/api/forum/topics/${topicId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName,
          content: replyText.trim(),
          avatarSeed: authorName
        })
      });
      setReplyInputMap(prev => ({ ...prev, [topicId]: '' }));
      fetchTopics();
      triggerToast("Balasan terkirim!");
    } catch (e) {}
  };

  // Delete Topic
  const handleDeleteTopic = async (topicId: string) => {
    try {
      await fetch(`/api/forum/topics/${topicId}`, { method: 'DELETE' });
      fetchTopics();
      triggerToast("Topik diskusi terhapus");
    } catch (e) {}
  };

  // Filter topics
  const filteredTopics = topics.filter(t => {
    const matchesLens = activeLensFilter === 'Semua' || t.lens === activeLensFilter;
    const matchesQuery = !searchQuery.trim() || 
      t.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.authorName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLens && matchesQuery;
  });

  const currentChannelObj = CHAT_CHANNELS.find(c => c.id === selectedChannel) || CHAT_CHANNELS[0];

  return (
    <div className="space-y-6 pb-16 max-w-6xl mx-auto px-2 sm:px-4">
      {/* Toast Notification Floating */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed top-6 right-6 z-50 bg-[#031466] text-white px-5 py-3 rounded-2xl shadow-2xl border border-blue-400/30 flex items-center gap-3 font-bold text-sm"
          >
            <Sparkles size={18} className="text-amber-400 shrink-0 animate-spin" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER BANNER & MODE SWITCHER */}
      <div className="bg-gradient-to-r from-[#031466] via-blue-900 to-indigo-900 text-white rounded-[32px] sm:rounded-[40px] p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-60 h-60 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-bold text-blue-200">
              <Radio size={14} className="text-emerald-400 animate-pulse" />
              <span>Komunikasi & Diskusi Komunitas</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
              Ruang Komunikasi Warga OutBubble 🫧
            </h1>
            <p className="text-sm sm:text-base text-blue-100 max-w-2xl font-medium">
              Tempat mengobrol langsung, bertukar pikiran, dan berdiskusi kritis bersama warga tanpa batas gelembung.
            </p>
          </div>

          {/* Citizen Live Status */}
          <div className="flex flex-wrap md:flex-col items-start md:items-end justify-between gap-3 shrink-0">
            <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-white shadow-inner">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <Users size={14} className="text-blue-200" />
              <span>{onlineCount} Warga Aktif</span>
            </div>
            <div className="px-3.5 py-1.5 bg-black/20 rounded-xl text-[11px] text-blue-200 flex items-center gap-1.5">
              <Eye size={12} />
              <span>{totalVisitors.toLocaleString()} Total Kunjungan</span>
            </div>
          </div>
        </div>

        {/* NAVIGATION TAB SWITCHER */}
        <div className="mt-8 pt-6 border-t border-white/15 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-black/20 p-1.5 rounded-2xl border border-white/10">
            <button
              onClick={() => { setActiveTab('chat'); playPopSound(); }}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 cursor-pointer",
                activeTab === 'chat' 
                  ? "bg-amber-500 text-white shadow-lg scale-105" 
                  : "text-blue-200 hover:text-white hover:bg-white/10"
              )}
            >
              <MessageCircle size={16} />
              <span>⚡ Obrolan Langsung (Live Chat)</span>
            </button>
            <button
              onClick={() => { setActiveTab('threads'); playPopSound(); }}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 cursor-pointer",
                activeTab === 'threads' 
                  ? "bg-amber-500 text-white shadow-lg scale-105" 
                  : "text-blue-200 hover:text-white hover:bg-white/10"
              )}
            >
              <MessageSquare size={16} />
              <span>📌 Papan Diskusi & Utas</span>
            </button>
          </div>

          {user?.isGuest && (
            <button
              onClick={() => openAuthModal('login', 'Masuk atau Daftar akun untuk ikut berdiskusi.')}
              className="px-4 py-2 bg-white text-[#031466] hover:bg-blue-50 rounded-xl text-xs font-black shadow-md transition-colors cursor-pointer flex items-center gap-2"
            >
              <span>🫧 Mode Tamu (Masuk / Daftar)</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODE 1: LIVE COMMUNITY CHAT ROOMS                          */}
      {/* ========================================================= */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          {/* CHANNELS SIDEBAR */}
          <div className="bg-white border border-slate-200 rounded-[28px] p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2 px-2 text-[#031466] font-black text-xs uppercase tracking-wider">
              <Hash size={16} className="text-blue-600" />
              <span>Pilih Saluran Obrolan</span>
            </div>

            <div className="space-y-1.5">
              {CHAT_CHANNELS.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => { setSelectedChannel(ch.id); playPopSound(); }}
                  className={cn(
                    "w-full text-left p-3 rounded-2xl transition-all flex items-start gap-3 cursor-pointer",
                    selectedChannel === ch.id
                      ? "bg-[#031466] text-white shadow-md font-bold"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700"
                  )}
                >
                  <span className="text-xl shrink-0 mt-0.5">{ch.icon}</span>
                  <div className="overflow-hidden">
                    <p className="text-xs font-black truncate">{ch.name}</p>
                    <p className={cn(
                      "text-[10px] line-clamp-1 mt-0.5",
                      selectedChannel === ch.id ? "text-blue-200" : "text-slate-400"
                    )}>
                      {ch.desc}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* CHANNEL NOTICE */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] text-amber-900 space-y-1">
              <p className="font-bold flex items-center gap-1 text-amber-800">
                <Shield size={12} />
                <span>Etika Berkomunikasi:</span>
              </p>
              <p className="text-amber-700 leading-relaxed">
                Jaga kesopanan, hindari ujaran kebencian, dan hormati perbedaan sudut pandang sesama warga.
              </p>
            </div>
          </div>

          {/* MAIN LIVE CHAT WINDOW */}
          <div className="lg:col-span-3 bg-white border border-slate-200 rounded-[28px] shadow-lg flex flex-col h-[600px] overflow-hidden">
            {/* CHAT HEADER */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 overflow-hidden">
                <span className="text-2xl shrink-0">{currentChannelObj.icon}</span>
                <div className="overflow-hidden">
                  <h3 className="text-sm font-black text-[#031466] truncate">#{currentChannelObj.name}</h3>
                  <p className="text-xs text-slate-400 truncate">{currentChannelObj.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-emerald-600 font-bold bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Live Auto-Sync</span>
              </div>
            </div>

            {/* CHAT MESSAGES STREAM */}
            <div 
              ref={chatScrollRef}
              className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 custom-scrollbar bg-[#f8faff]"
            >
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2">
                  <MessageCircle size={40} className="text-blue-300 animate-bounce" />
                  <p className="font-bold text-sm text-[#031466]">Belum ada pesan di saluran ini</p>
                  <p className="text-xs max-w-sm">Jadilah yang pertama memulai obrolan hangat bersama warga OutBubble!</p>
                </div>
              ) : (
                chatMessages.map(msg => {
                  const isMe = user?.id === msg.authorId;
                  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn("flex items-start gap-3 max-w-[85%]", isMe ? "ml-auto flex-row-reverse" : "")}
                    >
                      <img
                        src={msg.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.authorName}`}
                        alt={msg.authorName}
                        className="w-8 h-8 rounded-full border border-slate-200 bg-white shrink-0 object-cover mt-0.5"
                      />

                      <div className={cn("space-y-1", isMe ? "text-right" : "text-left")}>
                        <div className="flex items-center gap-2 px-1 text-[11px]">
                          <span className="font-black text-[#031466]">{msg.authorName}</span>
                          <span className="text-slate-400 text-[10px]">{timeStr}</span>
                        </div>

                        {/* MESSAGE BUBBLE */}
                        <div className={cn(
                          "p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-sm relative group",
                          isMe 
                            ? "bg-[#031466] text-white rounded-tr-none" 
                            : "bg-white text-slate-800 border border-slate-200 rounded-tl-none"
                        )}>
                          {msg.content && <p className="whitespace-pre-wrap font-medium">{msg.content}</p>}

                          {msg.image && (
                            <img
                              src={msg.image}
                              alt="Attached"
                              className="mt-2 rounded-xl max-h-48 object-cover border border-slate-200/50"
                            />
                          )}

                          {/* REACTION COUNTERS */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 mt-2">
                              {Object.entries(msg.reactions).map(([emoji, count]) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReactChatMessage(msg.id, emoji)}
                                  className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-amber-100 text-[11px] font-bold text-slate-700 flex items-center gap-1 border border-slate-200 transition-colors cursor-pointer"
                                >
                                  <span>{emoji}</span>
                                  <span>{count}</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* QUICK EMOJI BAR ON HOVER */}
                          <div className={cn(
                            "absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 shadow-md rounded-full px-2 py-1 flex items-center gap-1 z-10",
                            isMe ? "right-full mr-2" : "left-full ml-2"
                          )}>
                            {["👍", "❤️", "🔥", "💡"].map(e => (
                              <button
                                key={e}
                                onClick={() => handleReactChatMessage(msg.id, e)}
                                className="hover:scale-125 transition-transform text-xs cursor-pointer p-0.5"
                              >
                                {e}
                              </button>
                            ))}
                            {isMe && (
                              <button
                                onClick={() => handleDeleteChatMessage(msg.id)}
                                className="text-rose-500 hover:text-rose-700 p-0.5 ml-1"
                                title="Hapus pesan"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            {/* CHAT INPUT FORM */}
            <div className="p-3 sm:p-4 border-t border-slate-200 bg-white space-y-2">
              {chatImagePreview && (
                <div className="relative inline-block">
                  <img src={chatImagePreview} alt="Preview" className="h-16 rounded-xl border border-slate-200 object-cover" />
                  <button
                    onClick={() => setChatImagePreview(null)}
                    className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full shadow-md hover:bg-red-600"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {showChatEmojiPicker && (
                <div className="p-2 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap gap-1.5 animate-fadeIn">
                  {EMOJI_LIST.map(e => (
                    <button
                      key={e}
                      onClick={() => { setChatInput(prev => prev + e); setShowChatEmojiPicker(false); }}
                      className="p-1.5 hover:bg-white rounded-xl text-lg hover:scale-125 transition-transform cursor-pointer"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}

              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setShowChatEmojiPicker(!showChatEmojiPicker)}
                  className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-xl transition-colors cursor-pointer"
                  title="Pilih Emoji"
                >
                  <Smile size={20} />
                </button>

                <button
                  type="button"
                  onClick={() => chatFileInputRef.current?.click()}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
                  title="Lampirkan Gambar"
                >
                  <ImageIcon size={20} />
                </button>

                <input
                  type="file"
                  ref={chatFileInputRef}
                  onChange={handleChatImageUpload}
                  accept="image/*"
                  className="hidden"
                />

                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={`Ketik pesan di #${currentChannelObj.name}... (Terhubung langsung untuk semua warga)`}
                  className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-[#031466] focus:bg-white rounded-2xl text-xs sm:text-sm font-medium outline-none transition-all"
                />

                <button
                  type="submit"
                  disabled={!chatInput.trim() && !chatImagePreview}
                  className="px-4 py-2.5 bg-[#031466] hover:bg-blue-900 disabled:opacity-50 text-white rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer shadow-md shrink-0"
                >
                  <span>Kirim</span>
                  <Send size={14} />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODE 2: TOPIC DISCUSSION THREADS                           */}
      {/* ========================================================= */}
      {activeTab === 'threads' && (
        <div className="space-y-6">
          {/* SEARCH & CATEGORY FILTER */}
          <div className="bg-white border border-slate-200 rounded-[28px] p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="relative w-full md:w-80">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari topik atau nama penulis..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-[#031466] focus:bg-white rounded-2xl text-xs sm:text-sm font-medium outline-none transition-all"
                />
              </div>

              {/* LENS CATEGORY BUTTONS */}
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                {['Semua', 'Opini', 'Fakta', 'Kritik', 'Harapan'].map(lens => (
                  <button
                    key={lens}
                    onClick={() => { setActiveLensFilter(lens); playPopSound(); }}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer",
                      activeLensFilter === lens
                        ? "bg-[#031466] text-white shadow-md"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    {lens}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CREATE TOPIC POST FORM */}
          <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-md space-y-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-2 h-full bg-amber-500" />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={useRealName ? (user?.photoUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=Guest`) : `https://api.dicebear.com/7.x/avataaars/svg?seed=${customPseudonym}`}
                  alt="Avatar"
                  className="w-10 h-10 rounded-full border border-slate-200 object-cover"
                />
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-[#031466]">
                    {useRealName ? (user?.username || 'Warga OutBubble') : customPseudonym}
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold">
                    {useRealName ? 'Akun Terdaftar' : '🛡️ Mode Anonim Kritis'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  const fresh = PSEUDONYMS[Math.floor(Math.random() * PSEUDONYMS.length)];
                  setCustomPseudonym(fresh);
                  setUseRealName(false);
                  playPopSound();
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-amber-100 hover:text-amber-800 text-slate-600 rounded-xl text-[11px] font-bold transition-colors cursor-pointer"
              >
                🎲 Acak Pseudonym
              </button>
            </div>

            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              rows={3}
              placeholder="Tuliskan pemikiran, pertanyaan, atau analisis sudut pandangmu disini... (Akan langsung dipublikasikan ke seluruh warga)"
              className="w-full p-4 bg-slate-50 border border-slate-200 focus:border-[#031466] focus:bg-white rounded-2xl text-xs sm:text-sm font-medium outline-none resize-none transition-all"
            />

            {postImagePreview && (
              <div className="relative inline-block">
                <img src={postImagePreview} alt="Preview" className="h-28 rounded-2xl border border-slate-200 object-cover" />
                <button
                  onClick={() => setPostImagePreview(null)}
                  className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full shadow-md"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400">Kategori:</span>
                {['Opini', 'Fakta', 'Kritik', 'Harapan'].map(lens => (
                  <button
                    key={lens}
                    type="button"
                    onClick={() => setSelectedLens(lens)}
                    className={cn(
                      "px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer",
                      selectedLens === lens ? "bg-amber-500 text-white shadow-sm" : "bg-slate-100 text-slate-600"
                    )}
                  >
                    {lens}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => postFileInputRef.current?.click()}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
                  title="Lampirkan Gambar"
                >
                  <ImageIcon size={20} />
                </button>

                <input
                  type="file"
                  ref={postFileInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => setPostImagePreview(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                  accept="image/*"
                  className="hidden"
                />

                <button
                  onClick={handleCreateTopic}
                  disabled={!newPostContent.trim() && !postImagePreview}
                  className="px-5 py-2.5 bg-[#031466] hover:bg-blue-900 disabled:opacity-50 text-white rounded-2xl font-black text-xs sm:text-sm transition-all shadow-md cursor-pointer flex items-center gap-2"
                >
                  <span>Publikasikan Topik</span>
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* TOPICS FEED LIST */}
          <div className="space-y-4">
            {filteredTopics.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-[28px] p-12 text-center text-slate-400 space-y-2">
                <MessageSquare size={48} className="mx-auto text-blue-300" />
                <p className="font-bold text-[#031466]">Tidak ada topik diskusi ditemukan</p>
                <p className="text-xs">Coba kata kunci lain atau jadilah yang pertama memposting topik!</p>
              </div>
            ) : (
              filteredTopics.map(topic => {
                const isExpanded = expandedTopicId === topic.id;

                return (
                  <motion.div
                    key={topic.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm hover:shadow-md transition-shadow space-y-4"
                  >
                    {/* TOPIC HEADER */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={topic.authorAvatar?.startsWith('http') ? topic.authorAvatar : `https://api.dicebear.com/7.x/avataaars/svg?seed=${topic.authorAvatar || 'Felix'}`}
                          alt={topic.authorName}
                          className="w-10 h-10 rounded-full border border-slate-200 object-cover"
                        />
                        <div>
                          <h4 className="text-xs sm:text-sm font-black text-[#031466]">{topic.authorName}</h4>
                          <p className="text-[10px] text-slate-400 font-bold">
                            {new Date(topic.timestamp || topic.createdAt || Date.now()).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>

                      <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-black uppercase">
                        {topic.lens || 'Opini'}
                      </span>
                    </div>

                    {/* TOPIC CONTENT */}
                    <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-medium whitespace-pre-wrap">
                      {topic.content}
                    </p>

                    {topic.image && (
                      <img src={topic.image} alt="Post image" className="rounded-2xl max-h-72 w-full object-cover border border-slate-200" />
                    )}

                    {/* ACTIONS BAR */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handleLikeTopic(topic.id, topic.likes)}
                          className="flex items-center gap-1.5 text-slate-500 hover:text-rose-600 transition-colors cursor-pointer font-bold"
                        >
                          <Heart size={16} className={cn(topic.likes > 0 ? "fill-rose-500 text-rose-500" : "")} />
                          <span>{topic.likes || 0} Menyukai</span>
                        </button>

                        <button
                          onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)}
                          className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600 transition-colors cursor-pointer font-bold"
                        >
                          <MessageCircle size={16} />
                          <span>{topic.repliesCount || topic.replies?.length || 0} Balasan</span>
                        </button>

                        <button
                          onClick={() => handleRepostTopic(topic.id)}
                          className="flex items-center gap-1.5 text-slate-500 hover:text-emerald-600 transition-colors cursor-pointer font-bold"
                        >
                          <Repeat2 size={16} />
                          <span>{topic.repostsCount || 0} Repost</span>
                        </button>
                      </div>

                      <button
                        onClick={() => triggerToast("Tautan diskusi disalin ke clipboard!")}
                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                        title="Bagikan Tautan"
                      >
                        <Share2 size={16} />
                      </button>
                    </div>

                    {/* EXPANDABLE REPLIES SECTION */}
                    {isExpanded && (
                      <div className="pt-4 border-t border-slate-100 space-y-3 animate-fadeIn">
                        {/* REPLIES LIST */}
                        <div className="space-y-2">
                          {(topic.replies || []).map((rep: any) => (
                            <div key={rep.id} className="p-3 bg-slate-50 rounded-2xl text-xs space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-black text-[#031466]">{rep.authorName}</span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(rep.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-slate-700 font-medium">{rep.content}</p>
                            </div>
                          ))}
                        </div>

                        {/* REPLY FORM */}
                        <div className="flex items-center gap-2 pt-2">
                          <input
                            type="text"
                            value={replyInputMap[topic.id] || ''}
                            onChange={(e) => setReplyInputMap(prev => ({ ...prev, [topic.id]: e.target.value }))}
                            placeholder="Tulis balasan diskusi..."
                            className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:bg-white focus:border-[#031466]"
                          />
                          <button
                            onClick={() => handleSendReply(topic.id)}
                            className="px-4 py-2 bg-[#031466] text-white rounded-xl text-xs font-black hover:bg-blue-900 cursor-pointer"
                          >
                            Kirim
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Forum;
