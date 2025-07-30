'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/shadcnui/button'
import { ArrowLeft } from 'lucide-react'
import { LoadingDisplay } from './components/LoadingDisplay'
import { UserPersonalInfo } from './components/UserPersonalInfo'
import {SecurityInterface} from "@/lib/interface/securityInterface";

export function UserDetailsClient({ id, name }: SecurityInterface) {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading] = useState(false)

  useEffect(() => {
    if (!session?.user?.roles || session.user.roles !== 'ADMIN') {
      router.push('/')
      return
    }
  }, [session, router])

  if (loading) {
    return <LoadingDisplay />
  }

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8'>
      <motion.div
        className='max-w-4xl mx-auto space-y-6'
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className='flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4'>
          <h1 className='text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600'>
            Informations de l&apos;option
          </h1>
          <Button variant='outline' asChild className='hover:bg-gray-100'>
            <Link href='/admin/security' className='flex items-center gap-2'>
              <ArrowLeft className='h-4 w-4' />
              <span>Retour à la liste</span>
            </Link>
          </Button>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
          <UserPersonalInfo id={id} name={name} />
        </div>
      </motion.div>
    </div>
  )
}
