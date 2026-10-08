/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// Variable-backed so a theme switch flips every existing
  			// `bg-gray-800` / `text-gray-300` in the app at once. The
  			// `<alpha-value>` form keeps opacity modifiers working.
  			gray: {
  				50: 'rgb(var(--gray-50) / <alpha-value>)',
  				100: 'rgb(var(--gray-100) / <alpha-value>)',
  				200: 'rgb(var(--gray-200) / <alpha-value>)',
  				300: 'rgb(var(--gray-300) / <alpha-value>)',
  				400: 'rgb(var(--gray-400) / <alpha-value>)',
  				500: 'rgb(var(--gray-500) / <alpha-value>)',
  				600: 'rgb(var(--gray-600) / <alpha-value>)',
  				700: 'rgb(var(--gray-700) / <alpha-value>)',
  				800: 'rgb(var(--gray-800) / <alpha-value>)',
  				850: 'rgb(var(--gray-850) / <alpha-value>)',
  				900: 'rgb(var(--gray-900) / <alpha-value>)',
  				950: 'rgb(var(--gray-950) / <alpha-value>)'
  			},
  			slate: {
  				50: 'rgb(var(--gray-50) / <alpha-value>)',
  				100: 'rgb(var(--gray-100) / <alpha-value>)',
  				200: 'rgb(var(--gray-200) / <alpha-value>)',
  				300: 'rgb(var(--gray-300) / <alpha-value>)',
  				400: 'rgb(var(--gray-400) / <alpha-value>)',
  				500: 'rgb(var(--gray-500) / <alpha-value>)',
  				600: 'rgb(var(--gray-600) / <alpha-value>)',
  				700: 'rgb(var(--gray-700) / <alpha-value>)',
  				800: 'rgb(var(--gray-800) / <alpha-value>)',
  				900: 'rgb(var(--gray-900) / <alpha-value>)',
  				950: 'rgb(var(--gray-950) / <alpha-value>)'
  			},
  			// The app's own palette, named so `bg-surface/97` works the way
  			// `bg-[#12151B]/97` used to.
  			app: 'rgb(var(--app) / <alpha-value>)',
  			surface: 'rgb(var(--surface) / <alpha-value>)',
  			elevated: 'rgb(var(--elevated) / <alpha-value>)',
  			line: 'rgb(var(--line) / <alpha-value>)',
  			'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
  			ink: 'rgb(var(--ink) / <alpha-value>)',
  			'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',
  			'ink-soft': 'rgb(var(--ink-soft) / <alpha-value>)',
  			'ink-faint': 'rgb(var(--ink-faint) / <alpha-value>)',
  			brand: 'rgb(var(--brand) / <alpha-value>)',
  			'brand-strong': 'rgb(var(--brand-strong) / <alpha-value>)',
  			gold: 'rgb(var(--gold) / <alpha-value>)',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
