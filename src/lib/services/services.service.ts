'use server'
import prisma from '@/lib/prisma'

export async function findAllServices() {
  try {
    const result = await prisma.services.findMany()
    return result || []
  } catch (error) {
    console.error('Erreur lors de la recherche des services:', error)
    return []
  }
}

export async function createService(name: string) {
  try {
    return await prisma.services.create({
      data: {
        name
      }
    })
  } catch (error) {
    console.error('Erreur lors de la création d\'un service', error)
    return null
  }
}

export async function deleteService(id: string) {
  try {
    const req = await prisma.services.delete({
      where: {
        id
      }
    })
    if (req) return true;
  } catch (error) {
    console.error('Erreur lors de la suppresion d\'un service', error)
    return null
  }
}
