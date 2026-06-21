import React, { useState, useEffect } from 'react';

interface MascotBuddyProps {
  role: 'patient' | 'doctor';
}

interface Particle {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  char: string;
  color: string;
}

const PATIENT_QUOTES = [
  "Stay healthy! 🩺",
  "Your medical records are encrypted on device. 🔒",
  "Only you have the keys to decrypt them! 🔑",
  "We anchor proofs on Sui and store files on Walrus! 🌊🐋",
  "Need to share? Click 'Share via QR' to issue an access link! 📤",
  "Your data, your pouch! 💼",
  "Have you recorded your visit today? 🎤",
  "Drink water and stay safe! 💧"
];

const DOCTOR_QUOTES = [
  "Welcome, doctor! 🩺",
  "Input the Patient's Grant ID and Access Token to decrypt. 🔐",
  "Decryption keys are securely managed by Seal servers. 🛡️",
  "Only authorized physicians can view the plaintext. 👁️",
  "Patient data privacy is our highest priority! 🤝",
  "Secure end-to-end data flow verified by Sui! 🌊"
];

export function MascotBuddy({ role }: MascotBuddyProps) {
  const [isHidden, setIsHidden] = useState(false);
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const [bubbleText, setBubbleText] = useState('');
  const [isFlipping, setIsFlipping] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [clickCount, setClickCount] = useState(0);

  const quotes = role === 'patient' ? PATIENT_QUOTES : DOCTOR_QUOTES;

  // Show a welcome message shortly after mounting
  useEffect(() => {
    const timer = setTimeout(() => {
      showRandomQuote();
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const showRandomQuote = () => {
    const randomIndex = Math.floor(Math.random() * quotes.length);
    const quote = quotes[randomIndex] || '';
    setBubbleText(quote);
    setIsBubbleVisible(true);
  };

  const handleMouseEnter = () => {
    if (!isBubbleVisible) {
      showRandomQuote();
    }
  };

  const handleMouseLeave = () => {
    // Keep it visible for a bit or let it fade out
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 3D flip animation
    if (!isFlipping) {
      setIsFlipping(true);
      setTimeout(() => setIsFlipping(false), 800);
    }

    // Cycle text
    showRandomQuote();

    // Create particles at click location inside the buddy
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const chars = ['❤️', '➕', '✨', '🩹', '🌸'];
    const colors = ['#EF4444', '#B5E5E0', '#7FC5E3', '#F59E0B', '#10B981'];

    const newParticles: Particle[] = Array.from({ length: 6 }).map((_, i) => {
      const angle = (Math.PI * 2 * i) / 6 + (Math.random() * 0.5 - 0.25);
      const distance = 40 + Math.random() * 40;
      return {
        id: Date.now() + i + clickCount,
        startX: clickX,
        startY: clickY,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance - 20, // push up slightly
        char: chars[Math.floor(Math.random() * chars.length)] || '❤️',
        color: colors[Math.floor(Math.random() * colors.length)] || '#EF4444'
      };
    });

    setParticles((prev) => [...prev, ...newParticles]);
    setClickCount((c) => c + 6);

    // Clean up particles
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 1000);
  };

  if (isHidden) {
    return (
      <button
        onClick={() => {
          setIsHidden(false);
          setTimeout(showRandomQuote, 200);
        }}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.9)',
          border: '1px solid var(--primary-light)',
          borderRadius: '50%',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: 'var(--shadow)',
          fontSize: 18,
          transition: 'all 0.2s'
        }}
        title="Show Mascot Buddy"
      >
        🩺
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: 'var(--font-family)',
        pointerEvents: 'none'
      }}
    >
      {/* Speech Bubble */}
      {isBubbleVisible && (
        <div
          className="bubble-pop"
          style={{
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid var(--primary-light)',
            borderRadius: 16,
            padding: '10px 14px',
            maxWidth: 220,
            boxShadow: 'var(--shadow-lg)',
            marginBottom: 12,
            position: 'relative',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'auto'
          }}
        >
          {/* Close Bubble Button */}
          <button
            onClick={() => setIsBubbleVisible(false)}
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 10,
              cursor: 'pointer',
              padding: 2,
              lineHeight: 1
            }}
          >
            ✕
          </button>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', paddingRight: 8, lineHeight: 1.4 }}>
            {bubbleText}
          </p>
          {/* Bubble tail */}
          <div
            style={{
              position: 'absolute',
              bottom: -6,
              right: 28,
              width: 10,
              height: 10,
              background: 'rgba(255, 255, 255, 0.95)',
              borderBottom: '1px solid var(--primary-light)',
              borderRight: '1px solid var(--primary-light)',
              transform: 'rotate(45deg)'
            }}
          />
        </div>
      )}

      {/* Mascot Image Wrapper */}
      <div
        className={`mascot-float mascot-wiggle ${isFlipping ? 'flip-3d' : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          width: 64,
          height: 64,
          cursor: 'pointer',
          position: 'relative',
          pointerEvents: 'auto',
          userSelect: 'none'
        }}
      >
        <img
          src="/anampouch_logo_transparent.png"
          alt="AnamPouch Mascot"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter: 'drop-shadow(0 4px 10px rgba(45, 90, 142, 0.25))'
          }}
        />

        {/* Small Close Buddy Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsHidden(true);
          }}
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: 16,
            height: 16,
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            padding: 0
          }}
          title="Hide Mascot Buddy"
        >
          ✕
        </button>

        {/* Floating Particles */}
        {particles.map((p) => (
          <span
            key={p.id}
            className="particle-fade"
            style={{
              position: 'absolute',
              left: p.startX,
              top: p.startY,
              pointerEvents: 'none',
              fontSize: '16px',
              zIndex: 1001,
              color: p.color,
              textShadow: '0 2px 4px rgba(0,0,0,0.1)',
              ...{
                '--x': `${p.x}px`,
                '--y': `${p.y}px`
              } as React.CSSProperties
            }}
          >
            {p.char}
          </span>
        ))}
      </div>
    </div>
  );
}
