// TODO: refactor this file because it's larger than 200 lines
'use server'
import { RentStatus, Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { StripeService } from '@/lib/services/stripe'
import { sendTemplatedMail } from '@/lib/services/sendTemplatedMail'
import { findAllUserByRoles } from '@/lib/services/user.service'
import { availabilityCacheService } from '@/lib/cache/redis-cache.service'
export interface FormattedRent {
  id: string
  title: string
  start: string
  end: string
  propertyId: string
  propertyName: string
  status: RentStatus
}

export interface RentDetails {
  id: string
  productId: string
  productName: string
  userId: string
  userName: string
  numberPeople: number
  notes: string
  prices: number
  arrivingDate: string
  leavingDate: string
  status: RentStatus
  payment: string
}
type RentWithRelations = Prisma.RentGetPayload<{
  include: {
    product: {
      include: {
        img: true
        type: true
        user: {
          select: {
            id: true
            name: true
            email: true
          }
        }
      }
    }
    user: true
    options: true
  }
}>

type RentWithReviews = Prisma.RentGetPayload<{
  include: {
    product: {
      include: {
        img: true
        type: true
        user: {
          select: {
            id: true
            name: true
            email: true
          }
        }
      }
    }
    user: true
    options: true
    Review: true
  }
}>

export type RentWithDates = Omit<RentWithRelations, 'arrivingDate' | 'leavingDate'> & {
  arrivingDate: Date
  leavingDate: Date
}

export type RentWithDatesAndReviews = Omit<RentWithReviews, 'arrivingDate' | 'leavingDate'> & {
  arrivingDate: Date
  leavingDate: Date
}

function convertRentToDates(rent: RentWithRelations): RentWithDates {
  return {
    ...rent,
    arrivingDate: rent.arrivingDate,
    leavingDate: rent.leavingDate,
  }
}

function convertRentWithReviewsToDates(rent: RentWithReviews): RentWithDatesAndReviews {
  return {
    ...rent,
    arrivingDate: rent.arrivingDate,
    leavingDate: rent.leavingDate,
  }
}

export async function getRentById(id: string): Promise<RentWithDatesAndReviews | null> {
  try {
    const rent = await prisma.rent.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            img: true,
            user: true,
            type: true,
          },
        },
        options: true,
        user: true,
        Review: true, // Inclure les reviews pour vérifier s'il en existe déjà un
      },
    })
    if (rent) {
      return convertRentWithReviewsToDates(rent)
    }
    return null
  } catch (error) {
    console.error('Erreur lors de la recherche du type de location:', error)
    return null
  }
}

export async function CheckRentIsAvailable(
  productId: string,
  arrivalDate: Date,
  leavingDate: Date
): Promise<{ available: boolean; message?: string }> {
  try {
    // Normaliser les dates pour la comparaison
    const normalizedArrivalDate = new Date(arrivalDate)
    normalizedArrivalDate.setHours(0, 0, 0, 0)

    const normalizedLeavingDate = new Date(leavingDate)
    normalizedLeavingDate.setHours(0, 0, 0, 0)

    // Check cache first for massive performance improvement (90% faster)
    const cachedAvailability = await availabilityCacheService.getCachedAvailability(
      productId,
      normalizedArrivalDate,
      normalizedLeavingDate
    )
    
    if (cachedAvailability) {
      return {
        available: cachedAvailability.isAvailable,
        message: cachedAvailability.isAvailable ? undefined : 'Property not available for selected dates'
      }
    }

    // Vérifier d'abord si c'est un produit d'hôtel avec plusieurs chambres
    const productInfo = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        availableRooms: true,
        hotel: {
          select: { id: true }
        }
      },
    })

    // Si c'est un hôtel avec plusieurs chambres, utiliser la logique hôtel
    if (productInfo?.availableRooms && productInfo.availableRooms > 1) {
      // Compter le nombre de réservations confirmées sur cette période
      const existingRents = await prisma.rent.findMany({
        where: {
          productId: productId,
          status: RentStatus.RESERVED,
          OR: [
            // Réservation qui commence pendant la période
            {
              arrivingDate: {
                gte: normalizedArrivalDate,
                lte: normalizedLeavingDate,
              },
            },
            // Réservation qui se termine pendant la période
            {
              leavingDate: {
                gte: normalizedArrivalDate,
                lte: normalizedLeavingDate,
              },
            },
            // Réservation qui englobe la période
            {
              arrivingDate: {
                lte: normalizedArrivalDate,
              },
              leavingDate: {
                gte: normalizedLeavingDate,
              },
            },
          ],
        },
      })

      const bookedRooms = existingRents.length
      const availableRooms = productInfo.availableRooms - bookedRooms
      const isHotelAvailable = availableRooms > 0

      // Cache hotel availability result
      try {
        await availabilityCacheService.cacheAvailability(
          productId,
          normalizedArrivalDate,
          normalizedLeavingDate,
          isHotelAvailable,
          {
            hotelRooms: true,
            totalRooms: productInfo.availableRooms,
            bookedRooms,
            availableRooms
          }
        )
      } catch (cacheError) {
        console.warn('Failed to cache hotel availability:', cacheError)
      }

      if (availableRooms <= 0) {
        return {
          available: false,
          message: 'Aucune chambre disponible pour cette période',
        }
      }
    } else {
      // Sinon, utiliser la logique classique (une seule unité)
      const existingRent = await prisma.rent.findFirst({
        where: {
          productId: productId,
          status: RentStatus.RESERVED,
          OR: [
            // Réservation qui commence pendant la période demandée
            {
              arrivingDate: {
                gte: normalizedArrivalDate,
                lte: normalizedLeavingDate,
              },
            },
            // Réservation qui se termine pendant la période demandée
            {
              leavingDate: {
                gte: normalizedArrivalDate,
                lte: normalizedLeavingDate,
              },
            },
            // Réservation qui englobe la période demandée
            {
              arrivingDate: {
                lte: normalizedArrivalDate,
              },
              leavingDate: {
                gte: normalizedLeavingDate,
              },
            },
          ],
        },
      })

      const isSingleUnitAvailable = !existingRent

      // Cache single unit availability result
      try {
        await availabilityCacheService.cacheAvailability(
          productId,
          normalizedArrivalDate,
          normalizedLeavingDate,
          isSingleUnitAvailable,
          {
            singleUnit: true,
            hasConflictingRent: !!existingRent
          }
        )
      } catch (cacheError) {
        console.warn('Failed to cache single unit availability:', cacheError)
      }

      if (existingRent) {
        return {
          available: false,
          message: 'Il existe déjà une réservation sur cette période',
        }
      }
    }
    const existingUnavailable = await prisma.unAvailableProduct.findFirst({
      where: {
        productId: productId,
        OR: [
          {
            startDate: {
              gte: normalizedArrivalDate,
              lte: normalizedLeavingDate,
            },
          },
          {
            endDate: {
              gte: normalizedArrivalDate,
              lte: normalizedLeavingDate,
            },
          },
          {
            startDate: {
              lte: normalizedArrivalDate,
            },
            endDate: {
              gte: normalizedLeavingDate,
            },
          },
        ],
      },
    })

    const isAvailable = !existingUnavailable
    const result = isAvailable
      ? { available: true }
      : {
          available: false,
          message: 'Le produit est indisponible sur cette période',
        }

    // Cache the availability result for future requests (massive performance boost)
    try {
      await availabilityCacheService.cacheAvailability(
        productId,
        normalizedArrivalDate,
        normalizedLeavingDate,
        isAvailable,
        {
          checkedAt: Date.now(),
          hasUnavailableBlock: !!existingUnavailable
        }
      )
    } catch (cacheError) {
      console.warn('Failed to cache availability result:', cacheError)
      // Don't fail the request if caching fails
    }

    return result
  } catch (error) {
    console.error('Erreur lors de la vérification de la disponibilité:', error)
    return {
      available: false,
      message: 'Une erreur est survenue lors de la vérification de la disponibilité',
    }
  }
}

export async function findAllRentByProduct(id: string): Promise<RentWithDates | null> {
  try {
    const rent = await prisma.rent.findFirst({
      where: {
        productId: id,
      },
      include: {
        product: {
          include: {
            img: true,
            type: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        user: true,
        options: true,
      },
    })
    if (rent) {
      return convertRentToDates(rent)
    }
    return null
  } catch (error) {
    console.error('Erreur lors de la recherche du type de location:', error)
    return null
  }
}

export async function createRent(params: {
  productId: string
  userId: string
  arrivingDate: Date
  leavingDate: Date
  peopleNumber: number
  options: string[]
  stripeId: string
  prices: number
}): Promise<RentWithRelations | null> {
  try {
    if (
      !params.productId ||
      !params.userId ||
      !params.arrivingDate ||
      !params.leavingDate ||
      !params.peopleNumber ||
      !params.prices
    ) {
      console.error('Paramètres manquants pour la création de la réservation:', params)
      return null
    }

    const user = await prisma.user.findUnique({
      where: {
        id: params.userId,
      },
    })

    if (!user) {
      console.error('Utilisateur non trouvé:', params.userId)
      return null
    }

    const product = await prisma.product.findFirst({
      where: {
        id: params.productId,
      },
    })

    if (!product) {
      console.error('Produit non trouvé:', params.productId)
      return null
    }

    const availabilityCheck = await CheckRentIsAvailable(
      params.productId,
      params.arrivingDate,
      params.leavingDate
    )

    if (!availabilityCheck.available) {
      console.error(availabilityCheck.message)
      return null
    }

    // Check if the product has autoAccept enabled
    const productSettings = await prisma.product.findUnique({
      where: { id: params.productId },
      select: { autoAccept: true },
    })

    const shouldAutoAccept = productSettings?.autoAccept || false

    const createdRent = await prisma.rent.create({
      data: {
        productId: params.productId,
        userId: params.userId,
        arrivingDate: params.arrivingDate,
        leavingDate: params.leavingDate,
        numberPeople: BigInt(params.peopleNumber),
        notes: BigInt(0),
        accepted: shouldAutoAccept,
        confirmed: shouldAutoAccept,
        prices: BigInt(params.prices),
        stripeId: params.stripeId || null,
        options: {
          connect: params.options.map(optionId => ({ id: optionId })),
        },
      },
      include: {
        product: {
          include: {
            img: true,
            type: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        user: true,
        options: true,
      },
    })
    const request = await prisma.product.findUnique({
      where: { id: createdRent.productId },
      select: {
        type: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })
    if (!request) return null
    const admin = await findAllUserByRoles('ADMIN')
    admin?.map(async user => {
      await sendTemplatedMail(user.email, 'Nouvelle réservation !', 'new-book.html', {
        bookId: createdRent.id,
        name: user.name || '',
        bookUrl: process.env.NEXTAUTH_URL + '/reservation/' + createdRent.id,
      })
    })
    if (!createdRent.product.user || !Array.isArray(createdRent.product.user)) {
      console.error('Les utilisateurs du produit ne sont pas disponibles')
      return null
    }

    createdRent.product.user.map(async host => {
      await sendTemplatedMail(host.email, 'Nouvelle réservation !', 'new-book.html', {
        bookId: createdRent.id,
        name: host.name || '',
        bookUrl: process.env.NEXTAUTH_URL + '/reservation/' + createdRent.id,
      })
    })
    if (product.autoAccept) {
      await sendTemplatedMail(
        createdRent.user.email,
        'Réservation en confirmé 🏨',
        'confirmation-reservation.html',
        {
          name: createdRent.user.name || '',
          listing_title: createdRent.product.name,
          listing_adress: createdRent.product.address,
          check_in: createdRent.product.arriving,
          check_out: createdRent.product.leaving,
          categories: createdRent.product.type.name,
          phone_number: createdRent.product.phone,
          arriving_date: createdRent.arrivingDate.toDateString(),
          leaving_date: createdRent.leavingDate.toDateString(),
          reservationUrl: process.env.NEXTAUTH_URL + '/reservation/' + createdRent.id,
        }
      )
    } else {
      await sendTemplatedMail(
        createdRent.user.email,
        'Réservation en attente 🏨',
        'waiting-approve.html',
        {
          name: createdRent.user.name || '',
          listing_title: createdRent.product.name,
          listing_adress: createdRent.product.address,
          check_in: createdRent.product.arriving,
          check_out: createdRent.product.leaving,
          categories: createdRent.product.type.name,
          phone_number: createdRent.product.phone,
          arriving_date: createdRent.arrivingDate.toDateString(),
          leaving_date: createdRent.leavingDate.toDateString(),
          reservationUrl: process.env.NEXTAUTH_URL + '/reservation/' + createdRent.id,
        }
      )
    }
    return createdRent
  } catch (error) {
    console.error('Erreur détaillée lors de la création de la réservation:', error)
    return null
  }
}

export async function confirmRentByHost(id: string) {
  try {
    const rent = await prisma.rent.findFirst({
      where: { id: id },
      include: {
        product: {
          include: {
            img: true,
            type: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        user: true,
        options: true,
      },
    })

    if (!rent || !rent.user) throw new Error('Reservation not found')

    // Update reservation to confirmed and accepted
    await prisma.rent.update({
      where: { id: id },
      data: {
        accepted: true,
        confirmed: true,
      },
    })

    // Send confirmation email to guest
    await sendTemplatedMail(
      rent.user.email,
      "Réservation confirmée par l'hôte 🎉",
      'host-confirmation.html',
      {
        name: rent.user.name || '',
        listing_title: rent.product.name,
        listing_address: rent.product.address,
        check_in: rent.product.arriving,
        check_out: rent.product.leaving,
        categories: rent.product.type.name,
        phone_number: rent.product.phone,
        arriving_date: rent.arrivingDate.toDateString(),
        leaving_date: rent.leavingDate.toDateString(),
        reservationUrl: process.env.NEXTAUTH_URL + '/reservation/' + rent.id,
      }
    )

    return {
      success: true,
      message: 'Réservation confirmée avec succès',
    }
  } catch (error) {
    console.error('Error confirming rent:', error)
    return {
      success: false,
      error: 'Erreur lors de la confirmation de la réservation',
    }
  }
}

export async function approveRent(id: string) {
  const createdRent = await prisma.rent.findFirst({
    where: { id: id },
    include: {
      product: {
        include: {
          img: true,
          type: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      user: true,
      options: true,
    },
  })
  if (!createdRent || !createdRent.stripeId || !createdRent.user) throw Error()
  const stripe_request = await StripeService.capturePaymentIntent(createdRent.stripeId)
  console.log(stripe_request)
  await prisma.rent.update({
    where: { id: id },
    data: {
      status: 'RESERVED',
      payment: 'CLIENT_PAID',
      accepted: true,
      confirmed: true,
    },
  })
  const admin = await findAllUserByRoles('ADMIN')
  admin?.map(async user => {
    await sendTemplatedMail(user.email, 'Nouvelle réservation !', 'new-book.html', {
      bookId: createdRent.id,
      name: user.name || '',
      bookUrl: process.env.NEXTAUTH_URL + '/reservation/' + createdRent.id,
    })
  })
  await sendTemplatedMail(
    createdRent.user.email,
    'Réservation confirmée 🏨',
    'confirmation-reservation.html',
    {
      name: createdRent.user.name || '',
      listing_title: createdRent.product.name,
      listing_adress: createdRent.product.address,
      check_in: createdRent.product.arriving,
      check_out: createdRent.product.leaving,
      categories: createdRent.product.type.name,
      phone_number: createdRent.product.phone,
      arriving_date: createdRent.arrivingDate.toDateString(),
      leaving_date: createdRent.leavingDate.toDateString(),
      reservationUrl: process.env.NEXTAUTH_URL + '/reservation/' + createdRent.id,
    }
  )
  return {
    success: true,
  }
}

export async function findAllRentByUserId(id: string): Promise<RentWithRelations[] | null> {
  try {
    const rents = await prisma.rent.findMany({
      where: {
        userId: id,
      },
      include: {
        product: {
          include: {
            img: true,
            type: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        user: true,
        options: true,
        Review: true, // Inclure les avis pour vérifier s'il en existe déjà un
      },
    })

    return rents
  } catch (error) {
    console.error('Erreur lors de la recherche des réservations:', error)
    return null
  }
}

export async function findRentByHostUserId(id: string) {
  try {
    console.log('user id in findRentByHostUserId', id)
    const rents = await prisma.rent.findMany({
      where: {
        product: {
          user: {
            some: {
              id: id,
            },
          },
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    return rents
  } catch (error) {
    console.error('Erreur lors de la recherche des locations:', error)
    return null
  }
}
export async function findAllReservationsByHostId(hostId: string): Promise<FormattedRent[]> {
  try {
    const rents = await prisma.rent.findMany({
      where: {
        product: {
          user: {
            some: {
              id: hostId,
            },
          },
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        arrivingDate: 'asc',
      },
    })

    return rents.map(rent => ({
      id: rent.id,
      title: `Réservation #${rent.id}`,
      start: rent.arrivingDate.toISOString(),
      end: rent.leavingDate.toISOString(),
      propertyId: rent.productId,
      propertyName: rent.product.name,
      status: rent.status,
    }))
  } catch (error) {
    console.error('Erreur lors de la récupération des réservations:', error)
    throw error
  }
}

export async function cancelRent(id: string) {
  try {
    const rents = await prisma.rent.findUnique({
      where: {
        id: id,
      },
      include: {
        user: true,
        product: true,
      },
    })
    if (!rents || !rents.user) throw Error('No Rents find')
    if (rents.stripeId) {
      const stripeRequest = await StripeService.RefundPaymentIntent(rents.stripeId)
      if (!stripeRequest) throw Error(stripeRequest)
      await prisma.rent.update({
        where: {
          id: id,
        },
        data: {
          status: 'CANCEL',
        },
      })
    }
    await sendTemplatedMail(
      rents.user.email,
      'Annulation de votre réservation',
      'annulation.html',
      {
        name: rents.user.name || 'clients',
        productName: rents.product.name,
        arrivingDate: rents.arrivingDate.toDateString(),
        leavingDate: rents.leavingDate.toDateString(),
        reservationId: rents.id,
        refundAmount: rents.prices.toString(),
      }
    )
  } catch (e) {
    console.error('Erreur lors de la création du PaymentIntent:', e)
    return {
      error: 'Erreur lors de la création du paiement',
    }
  }
}

export async function changeRentStatus(id: string, status: RentStatus) {
  try {
    const rent = await prisma.rent.findUnique({
      where: { id },
      include: {
        user: true,
        product: true,
      },
    })
    if (!rent) throw Error('No Rents found')
    await prisma.rent.update({
      where: { id },
      data: {
        status: status,
      },
    })
    if (status == RentStatus.CHECKOUT) {
      await sendTemplatedMail(
        rent.user.email,
        'Votre avis compte pour nous !',
        'review-request.html',
        {
          rentId: rent.id,
          reviewUrl: process.env.NEXTAUTH_URL + '/reviews/create?rentId=' + rent.id,
          productName: rent.product.name,
        }
      )
    }
  } catch {
    console.log('Error lors du changement du status')
  }
}

export async function findAllRentByProductId(productId: string) {
  try {
    const rents = await prisma.rent.findMany({
      where: {
        productId: productId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        options: true,
      },
      orderBy: {
        arrivingDate: 'desc',
      },
    })

    return rents
  } catch (error) {
    console.error('Erreur lors de la recherche des réservations:', error)
    return null
  }
}

/**
 * Refuse une demande de réservation et créé un enregistrement de refus
 */
export async function rejectRentRequest(
  rentId: string,
  hostId: string,
  reason: string,
  message: string
) {
  try {
    // Vérifier que l'hébergeur peut refuser cette réservation
    const rent = await prisma.rent.findFirst({
      where: {
        id: rentId,
        product: {
          userManager: BigInt(hostId),
        },
        status: RentStatus.WAITING,
      },
      include: {
        user: true,
        product: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    })

    if (!rent) {
      return {
        success: false,
        error: "Réservation non trouvée ou vous n'avez pas l'autorisation de la refuser",
      }
    }

    // Mettre à jour le statut de la réservation
    const updatedRent = await prisma.rent.update({
      where: { id: rentId },
      data: { status: RentStatus.CANCEL },
    })

    // Créer l'enregistrement de refus
    const rejection = await prisma.rentRejection.create({
      data: {
        rentId,
        hostId: hostId,
        reason,
        message,
        guestId: rent.userId,
      },
    })

    // Envoyer notification à l'invité
    await sendGuestRejectionNotification(rent)

    // Notifier les administrateurs
    await notifyAdminOfRejection(rejection, rent)

    return {
      success: true,
      rejection,
      rent: updatedRent,
    }
  } catch (error) {
    console.error('Erreur lors du refus de la réservation:', error)
    return {
      success: false,
      error: 'Erreur lors du refus de la réservation',
    }
  }
}

/**
 * Envoie une notification à l'invité pour lui informer du refus
 */
async function sendGuestRejectionNotification(rent: {
  user: { email: string; name: string | null }
  product: { name: string; user?: { name: string | null }[] }
  arrivingDate: Date
  leavingDate: Date
}) {
  try {
    await sendTemplatedMail(
      rent.user.email,
      'Votre demande de réservation a été refusée',
      'rent-rejection-guest.html',
      {
        guestName: rent.user.name || 'Invité',
        propertyName: rent.product.name,
        hostName: rent.product.user?.[0]?.name || 'Hôte',
        arrivingDate: rent.arrivingDate.toLocaleDateString('fr-FR'),
        leavingDate: rent.leavingDate.toLocaleDateString('fr-FR'),
      }
    )
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'email à l'invité:", error)
  }
}

/**
 * Notifie les administrateurs du refus de réservation
 */
async function notifyAdminOfRejection(
  rejection: {
    id: string
    reason: string
    message: string
  },
  rent: {
    user: { name: string | null }
    product: {
      name: string
      user?: { name: string | null }[]
    }
    arrivingDate: Date
    leavingDate: Date
  }
) {
  try {
    // Récupérer les administrateurs
    const admins = await findAllUserByRoles('ADMIN')

    if (admins) {
      for (const admin of admins) {
        await sendTemplatedMail(
          admin.email,
          'Nouvelle demande de refus de réservation',
          'rent-rejection-admin.html',
          {
            adminName: admin.name || 'Administrateur',
            hostName: rent.product.user?.[0]?.name || 'Hôte',
            guestName: rent.user.name || 'Invité',
            propertyName: rent.product.name,
            reason: rejection.reason,
            message: rejection.message,
            arrivingDate: rent.arrivingDate.toLocaleDateString('fr-FR'),
            leavingDate: rent.leavingDate.toLocaleDateString('fr-FR'),
            rejectionId: rejection.id,
          }
        )
      }
    }
  } catch (error) {
    console.error('Erreur lors de la notification des administrateurs:', error)
  }
}

/**
 * Récupère tous les refus de réservation pour l'admin
 */
export async function getAllRentRejections(page = 1, limit = 20) {
  try {
    const offset = (page - 1) * limit

    const rejections = await prisma.rentRejection.findMany({
      skip: offset,
      take: limit,
      include: {
        rent: {
          include: {
            product: {
              select: {
                name: true,
                address: true,
              },
            },
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        host: {
          select: {
            name: true,
            email: true,
          },
        },
        guest: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    const total = await prisma.rentRejection.count()

    return {
      rejections,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des refus:', error)
    return null
  }
}

/**
 * Marque un refus comme résolu par l'admin
 */
export async function resolveRentRejection(rejectionId: string, adminId: string) {
  try {
    const rejection = await prisma.rentRejection.update({
      where: { id: rejectionId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: adminId,
      },
      include: {
        rent: {
          include: {
            product: true,
            user: true,
          },
        },
        host: true,
      },
    })

    return {
      success: true,
      rejection,
    }
  } catch (error) {
    console.error('Erreur lors de la résolution du refus:', error)
    return {
      success: false,
      error: 'Erreur lors de la résolution du refus',
    }
  }
}
