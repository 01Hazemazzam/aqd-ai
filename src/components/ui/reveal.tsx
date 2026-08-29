'use client'
import { motion, type HTMLMotionProps } from 'motion/react'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** A single element fading/rising into place on mount. */
export function FadeIn({
  delay = 0,
  y = 10,
  className,
  children,
  ...rest
}: { delay?: number; y?: number } & Omit<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'transition'>) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: EASE_OUT }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } },
}

/** Renders as <ul>; children should be <StaggerItem> wrapping each <li>'s content. */
export function StaggerList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <motion.ul initial="hidden" animate="show" variants={listVariants} className={className}>
      {children}
    </motion.ul>
  )
}

export function StaggerItem({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <motion.li variants={itemVariants} className={className}>
      {children}
    </motion.li>
  )
}
