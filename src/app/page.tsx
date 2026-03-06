'use client';

import Link from 'next/link';
import {
    Camera,
    Pencil,
    Clapperboard,
    Hexagon,
    Globe,
    Box,
    Download,
    Palette,
    Sparkles,
} from 'lucide-react';
import TopNavBar from '@/components/shared/TopNavBar';
import { cn } from '@/lib/utils';

// ─── Data ────────────────────────────────────────────────────────────────────

const recentProjects = [
    {
        id: 'p1',
        name: 'Go2 Robot Dog',
        type: 'Model',
        typeColor: '#9b7dff',
        typeBg: '#7c5cfc20',
        time: '2 hours ago',
        faces: '28.8K faces',
        status: 'Complete',
        statusColor: '#4ade80',
    },
    {
        id: 'p2',
        name: 'Factory Floor',
        type: 'Scene',
        typeColor: '#4a90d9',
        typeBg: '#4a90d920',
        time: 'Yesterday',
        faces: '142K faces',
        status: 'Complete',
        statusColor: '#4ade80',
    },
    {
        id: 'p3',
        name: 'Robot Arm v2',
        type: 'Model',
        typeColor: '#9b7dff',
        typeBg: '#7c5cfc20',
        time: '3 hours ago',
        faces: '15.2K faces',
        status: 'Processing',
        statusColor: '#D5B451',
    },
    {
        id: 'p4',
        name: 'DGX Spark',
        type: 'Model',
        typeColor: '#9b7dff',
        typeBg: '#7c5cfc20',
        time: '2 days ago',
        faces: '8.5K faces',
        status: 'Complete',
        statusColor: '#4ade80',
    },
    {
        id: 'p5',
        name: 'Outdoor Terrain',
        type: 'World',
        typeColor: '#D5B451',
        typeBg: '#D5B45120',
        time: '3 days ago',
        faces: '320K faces',
        status: 'Draft',
        statusColor: '#4D6E8A',
    },
    {
        id: 'p6',
        name: 'Apartment Interior',
        type: 'Scene',
        typeColor: '#4a90d9',
        typeBg: '#4a90d920',
        time: '4 days ago',
        faces: '85K faces',
        status: 'Complete',
        statusColor: '#4ade80',
    },
];

const activityItems = [
    {
        icon: <Box size={16} />,
        iconColor: '#7c5cfc',
        iconBg: '#7c5cfc15',
        desc: "Generated model 'Robot Arm v2'",
        time: '3 hours ago',
    },
    {
        icon: <Globe size={16} />,
        iconColor: '#4a90d9',
        iconBg: '#4a90d915',
        desc: "Reconstructed scene 'Factory Floor'",
        time: 'Yesterday',
    },
    {
        icon: <Download size={16} />,
        iconColor: '#4ade80',
        iconBg: '#4ade8015',
        desc: "Exported 'Go2 Dog' as USDZ",
        time: '2 days ago',
    },
    {
        icon: <Palette size={16} />,
        iconColor: '#D5B451',
        iconBg: '#D5B45115',
        desc: "Applied texture to 'DGX Spark'",
        time: '3 days ago',
    },
    {
        icon: <Hexagon size={16} />,
        iconColor: '#f87171',
        iconBg: '#f8717115',
        desc: "Retopologized 'Factory Floor'",
        time: '4 days ago',
    },
];

const quickActions = [
    {
        icon: <Camera size={24} />,
        iconColor: '#4a90d9',
        title: 'Image to 3D',
        subtitle: 'Upload a photo, get a model',
        href: '/workspace/image',
    },
    {
        icon: <Pencil size={24} />,
        iconColor: '#7c5cfc',
        title: 'Text to 3D',
        subtitle: 'Describe any object',
        href: '/workspace/model',
    },
    //   {
    //     icon: <Clapperboard size={24} />,
    //     iconColor: '#4ade80',
    //     title: 'Video to Scene',
    //     subtitle: 'Reconstruct from video',
    //     href: '/workspace/scene',
    //   },
    //   {
    //     icon: <Hexagon size={24} />,
    //     iconColor: '#f87171',
    //     title: 'Retopology',
    //     subtitle: 'Optimize existing mesh',
    //     href: '/workspace/retopo',
    //   },
    //   {
    //     icon: <Globe size={24} />,
    //     iconColor: '#D5B451',
    //     title: 'Build World',
    //     subtitle: 'Arrange assets in 3D',
    //     href: '/workspace/world',
    //   },
];

const templates = [
    { title: 'Industrial Warehouse', btn: 'Use Template' },
    { title: 'Robot Assembly Line', btn: 'Use Template' },
    { title: 'Outdoor Terrain', btn: 'Use Template' },
];

const communityItems = [
    {
        title: 'Mech Warrior',
        creator: '@alex_3d',
        likes: '342',
        views: '1.2K',
        image: 'https://images.unsplash.com/photo-1748749858656-e97077bca3c4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3NzEyNjA2NjF8&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
        title: 'Cyber City',
        creator: '@maya_cg',
        likes: '218',
        views: '856',
        image: 'https://images.unsplash.com/photo-1535391879778-3bae11d29a24?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3NzEyNjA2NjZ8&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
        title: 'Classic Mustang',
        creator: '@car_modeler',
        likes: '567',
        views: '2.1K',
        image: 'https://images.unsplash.com/photo-1591658903875-c76332509d50?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3NzEyNjA2NzR8&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
        title: 'Ancient Temple',
        creator: '@env_artist',
        likes: '189',
        views: '634',
        image: 'https://images.unsplash.com/photo-1706352046306-55e791b9b508?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3NzEyNjA2Nzd8&ixlib=rb-4.1.0&q=80&w=1080',
    },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: (typeof recentProjects)[0] }) {
    return (
        <div
            className="flex flex-col rounded-xl overflow-hidden cursor-pointer group flex-1 min-w-0"
            style={{ background: '#13304F', border: '1px solid #1A3A5A' }}
        >
            {/* Thumbnail */}
            <div className="h-[140px] w-full relative bg-[#0E243E] flex items-center justify-center">
                <Box size={40} className="opacity-10 text-white" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </div>

            {/* Info */}
            <div className="flex flex-col gap-1.5 px-3.5 py-3">
                <span className="text-[13px] font-semibold text-white truncate">
                    {project.name}
                </span>
                <div className="flex items-center gap-2">
                    <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded"
                        style={{ color: project.typeColor, background: project.typeBg }}
                    >
                        {project.type}
                    </span>
                    <span className="text-[10px]" style={{ color: '#4D6E8A' }}>
                        {project.time}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: '#4D6E8A' }}>
                        {project.faces}
                    </span>
                    <div className="flex items-center gap-1">
                        <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: project.statusColor }}
                        />
                        <span className="text-[10px] font-medium" style={{ color: project.statusColor }}>
                            {project.status}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
    return (
        <div className="flex flex-col min-h-screen" style={{ background: '#0A1E35' }}>
            <TopNavBar />

            {/* Scrollable page content */}
            <div className="flex-1 flex flex-col overflow-y-auto scrollbar-thin">

                {/* ── Hero Section ────────────────────────────────────────────────── */}
                <section className="relative w-full shrink-0" style={{ height: 340 }}>
                    {/* Multi-layer background matching design gradients */}
                    <div
                        className="absolute inset-0"
                        style={{
                            background: 'linear-gradient(90deg, #0A1E35EE 0%, #0E243ECC 45%, #0E243E88 70%, #0E243E40 100%)',
                        }}
                    />
                    <div
                        className="absolute inset-0"
                        style={{
                            background: 'linear-gradient(180deg, #0A1E35FF 0%, #0A1E3500 30%)',
                        }}
                    />
                    <div
                        className="absolute inset-0"
                        style={{
                            background: 'linear-gradient(0deg, #0A1E35DD 0%, #0A1E3500 25%)',
                        }}
                    />

                    {/* Decorative grid lines */}
                    <div
                        className="absolute pointer-events-none"
                        style={{ right: 80, top: 0, bottom: 0, opacity: 0.08 }}
                    >
                        <svg width="500" height="280" viewBox="0 0 500 280">
                            <line x1="50" y1="80" x2="450" y2="80" stroke="#D5B451" strokeWidth="0.5" />
                            <line x1="50" y1="140" x2="450" y2="140" stroke="#D5B451" strokeWidth="0.5" />
                            <line x1="50" y1="200" x2="450" y2="200" stroke="#D5B451" strokeWidth="0.5" />
                            <line x1="150" y1="40" x2="150" y2="240" stroke="#D5B451" strokeWidth="0.5" />
                            <line x1="250" y1="40" x2="250" y2="240" stroke="#D5B451" strokeWidth="0.5" />
                            <line x1="350" y1="40" x2="350" y2="240" stroke="#D5B451" strokeWidth="0.5" />
                        </svg>
                    </div>

                    {/* Decorative globe rings */}
                    {/* <div
                        className="absolute pointer-events-none"
                        style={{ right: 120, top: 30, opacity: 0.12 }}
                    >
                        <div
                            className="rounded-full"
                            style={{ width: 220, height: 220, border: '1.5px solid #D5B451' }}
                        />
                        <div
                            className="absolute rounded-full"
                            style={{
                                width: 140,
                                height: 140,
                                border: '1px solid #D5B451',
                                top: 40,
                                left: 40,
                                opacity: 0.7,
                            }}
                        />
                    </div> */}

                    {/* Hero content */}
                    <div
                        className="relative z-10 flex flex-col gap-4 px-16 justify-center h-full"
                        style={{ maxWidth: 600 }}
                    >
                        <h1 className="text-[32px] font-bold text-white leading-tight">
                            Welcome back, Johnny
                        </h1>
                        <p className="text-base" style={{ color: '#8BA4BE' }}>
                            Describe it. Scan it. Build with it.
                        </p>
                        <div className="flex items-center gap-3 pt-2">
                            <Link
                                href="/workspace/model"
                                className="flex items-center gap-2 px-6 py-3 rounded-[10px] text-sm font-semibold transition-opacity hover:opacity-90"
                                style={{ background: '#D5B451', color: '#0E243E' }}
                            >
                                <Sparkles size={18} />
                                New Model
                            </Link>
                            {/* <Link
                                href="/workspace/scene"
                                className="flex items-center gap-2 px-6 py-3 rounded-[10px] text-sm font-semibold border transition-colors hover:bg-white/5"
                                style={{ borderColor: '#D5B451', color: '#D5B451', borderWidth: 1.5 }}
                            >
                                <Globe size={18} />
                                New Scene
                            </Link> */}
                        </div>
                    </div>
                </section>

                {/* ── Quick Start ──────────────────────────────────────────────────── */}
                <section className="px-16 pt-7 flex flex-col gap-4">
                    <h2 className="text-[18px] font-semibold text-white">Quick Start</h2>
                    <div className="grid grid-cols-5 gap-3.5">
                        {quickActions.map((action) => (
                            <Link
                                key={action.href}
                                href={action.href}
                                className="flex flex-col gap-2 rounded-xl transition-colors cursor-pointer hover:opacity-90"
                                style={{
                                    background: '#13304F',
                                    border: '1px solid #1A3A5A',
                                    padding: '20px 16px',
                                }}
                            >
                                <span style={{ color: action.iconColor }}>{action.icon}</span>
                                <span className="text-[13px] font-semibold text-white">{action.title}</span>
                                <span className="text-[11px] leading-tight" style={{ color: '#4D6E8A' }}>
                                    {action.subtitle}
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>

                {/* ── Main Content Area ────────────────────────────────────────────── */}
                <section className="flex gap-7 px-16 py-7">

                    {/* Left Column — Recent Projects */}
                    {/* <div className="flex flex-col gap-5 flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                            <h2 className="text-[18px] font-semibold text-white">Recent Projects</h2>
                            <button
                                className="text-xs font-medium transition-opacity hover:opacity-80"
                                style={{ color: '#D5B451' }}
                            >
                                View All →
                            </button>
                        </div>

                        <div className="flex flex-col gap-3.5">
                            <div className="flex gap-3.5">
                                {recentProjects.slice(0, 3).map((p) => (
                                    <ProjectCard key={p.id} project={p} />
                                ))}
                            </div>
                            <div className="flex gap-3.5">
                                {recentProjects.slice(3, 6).map((p) => (
                                    <ProjectCard key={p.id} project={p} />
                                ))}
                            </div>
                        </div>
                    </div> */}

                    {/* Right Column */}
                    <div className="flex flex-col gap-5 shrink-0" style={{ width: 380 }}>

                        {/* Recent Activity */}
                        {/* <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-[15px] font-semibold text-white">Recent Activity</h3>
                                <button
                                    className="text-[11px] font-medium transition-opacity hover:opacity-80"
                                    style={{ color: '#D5B451' }}
                                >
                                    View All →
                                </button>
                            </div>
                            <div
                                className="rounded-[10px] overflow-hidden"
                                style={{ background: '#13304F', border: '1px solid #1A3A5A' }}
                            >
                                {activityItems.map((item, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            'flex items-center gap-2.5 px-3.5 py-3',
                                            i < activityItems.length - 1 && 'border-b'
                                        )}
                                        style={
                                            i < activityItems.length - 1
                                                ? { borderColor: '#1A3A5A' }
                                                : undefined
                                        }
                                    >
                                        <div
                                            className="flex items-center justify-center rounded-lg shrink-0"
                                            style={{ width: 32, height: 32, background: item.iconBg }}
                                        >
                                            <span style={{ color: item.iconColor }}>{item.icon}</span>
                                        </div>
                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                            <span className="text-xs text-white truncate">{item.desc}</span>
                                            <span className="text-[10px]" style={{ color: '#4D6E8A' }}>
                                                {item.time}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div> */}

                        {/* Usage & Credits */}
                        {/* <div
                            className="rounded-xl flex flex-col gap-3.5"
                            style={{
                                background: '#13304F',
                                border: '1px solid #1A3A5A',
                                padding: 18,
                            }}
                        >
                            <h3 className="text-[15px] font-semibold text-white">Usage &amp; Credits</h3>

                            <div className="flex items-center gap-2.5">
                                <span className="text-[36px] font-bold text-white leading-none">300</span>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs" style={{ color: '#8BA4BE' }}>
                                        credits remaining
                                    </span>
                                    <span className="text-[11px] font-medium" style={{ color: '#D5B451' }}>
                                        Upgrade for more
                                    </span>
                                </div>
                            </div>

                            <div className="w-full h-px" style={{ background: '#1A3A5A' }} />

                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px]" style={{ color: '#8BA4BE' }}>
                                        Credits used this month
                                    </span>
                                    <span className="text-[11px] font-medium text-white">120 / 500</span>
                                </div>
                                <div
                                    className="w-full h-1.5 rounded-full overflow-hidden"
                                    style={{ background: '#183A5A' }}
                                >
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: '24%',
                                            background: 'linear-gradient(90deg, #D5B451 0%, #7c5cfc 100%)',
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px]" style={{ color: '#8BA4BE' }}>
                                        Models generated
                                    </span>
                                    <span className="text-[11px] font-medium text-white">14 this month</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px]" style={{ color: '#8BA4BE' }}>
                                        Storage used
                                    </span>
                                    <span className="text-[11px] font-medium text-white">2.3 GB / 10 GB</span>
                                </div>
                            </div>
                        </div> */}

                        {/* Templates & Inspiration */}
                        {/* <div className="flex flex-col gap-3">
                            <h3 className="text-[15px] font-semibold text-white">
                                Templates &amp; Inspiration
                            </h3>
                            <div className="flex flex-col gap-2.5">
                                {templates.map((t) => (
                                    <div
                                        key={t.title}
                                        className="flex items-center gap-3 rounded-[10px] cursor-pointer hover:opacity-90 transition-opacity"
                                        style={{
                                            background: '#13304F',
                                            border: '1px solid #1A3A5A',
                                            padding: '10px 12px',
                                        }}
                                    >
                                        <div
                                            className="rounded-lg shrink-0 bg-[#0E243E]"
                                            style={{ width: 56, height: 56 }}
                                        />
                                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                                            <span className="text-xs font-semibold text-white truncate">
                                                {t.title}
                                            </span>
                                            <span
                                                className="text-[10px] font-medium"
                                                style={{ color: '#D5B451' }}
                                            >
                                                {t.btn}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div> */}
                    </div>
                </section>

                {/* ── Community Section ────────────────────────────────────────────── */}
                {/* <section
                    className="flex flex-col gap-4 px-16 pb-8"
                    style={{ paddingTop: 12 }}
                >
                    <div className="w-full h-px" style={{ background: '#1A3A5A' }} />

                    <div className="flex items-center justify-between">
                        <h2 className="text-[18px] font-semibold text-white">Community</h2>
                        <button
                            className="text-xs font-medium transition-opacity hover:opacity-80"
                            style={{ color: '#D5B451' }}
                        >
                            Explore All →
                        </button>
                    </div>

                    <div className="grid grid-cols-4 gap-3.5">
                        {communityItems.map((item) => (
                            <div
                                key={item.title}
                                className="rounded-xl overflow-hidden cursor-pointer group hover:opacity-90 transition-opacity"
                                style={{ background: '#13304F', border: '1px solid #1A3A5A' }}
                            >

                                <div className="h-[120px] relative overflow-hidden">
                                    <img
                                        src={item.image}
                                        alt={item.title}
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                </div>

                                <div className="flex flex-col gap-1.5 px-3 py-2.5">
                                    <span className="text-xs font-semibold text-white">{item.title}</span>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px]" style={{ color: '#4D6E8A' }}>
                                            by {item.creator}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px]" style={{ color: '#4D6E8A' }}>
                                                ❤ {item.likes}
                                            </span>
                                            <span className="text-[10px]" style={{ color: '#4D6E8A' }}>
                                                👁 {item.views}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section> */}
            </div>
        </div>
    );
}
