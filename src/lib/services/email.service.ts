'use server'
import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import Mail from 'nodemailer/lib/mailer'
import fs from 'fs'
import path from 'path'

export async function SendMail(
  email: string,
  name: string,
  message: string,
  isHtml: boolean = false
) {
  const transport = nodemailer.createTransport({
    host: 'ssl0.ovh.net',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_LOGIN,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
    // DKIM temporairement désactivé pour éviter les conflits
    // dkim: {
    //   domainName: 'hosteed.com',
    //   keySelector: 'ovh', 
    //   privateKey: process.env.DKIM_PRIVATE_KEY || '',
    // },
  } as nodemailer.TransportOptions)

  const mailOptions: Mail.Options = {
    from: `"Hosteed" <${process.env.EMAIL_LOGIN}>`,
    replyTo: process.env.EMAIL_LOGIN,
    to: email,
    subject: `${name}`,
    headers: {
      'X-Mailer': 'Hosteed Platform',
      'X-Priority': '3',
    },
    ...(isHtml ? { html: message } : { text: message }),
  }
  const sendMailPromise = () =>
    new Promise<string>((resolve, reject) => {
      transport.sendMail(mailOptions, function (err) {
        if (!err) {
          resolve('Email sent')
        } else {
          reject(err.message)
        }
      })
    })

  try {
    await sendMailPromise()
    console.log('EMAIL ENVOYÉ AVEC SUCCÈS')
    return NextResponse.json({ message: 'Email sent' })
  } catch (err) {
    console.error("ERREUR D'ENVOI D'EMAIL:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Erreur inconnue',
        details: err,
      },
      { status: 500 }
    )
  }
}

export async function sendEmailFromTemplate(
  templateName: string,
  email: string,
  subject: string,
  variables: Record<string, string>
) {
  try {
    // Lire le template
    const templatePath = path.join(process.cwd(), 'public/templates/emails', `${templateName}.html`)
    let htmlContent = fs.readFileSync(templatePath, 'utf8')

    // Remplacer les variables
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g')
      htmlContent = htmlContent.replace(regex, value || '')
    })

    // Gérer les conditions {{#if variable}}...{{/if}}
    htmlContent = htmlContent.replace(
      /{{#if\s+(\w+)}}([\s\S]*?){{\/if}}/g,
      (match, variable, content) => {
        return variables[variable] && variables[variable].trim() !== '' ? content : ''
      }
    )

    // Créer le transport
    const transport = nodemailer.createTransport({
      host: 'ssl0.ovh.net',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_LOGIN,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
      // DKIM temporairement désactivé pour éviter les conflits
      // dkim: {
      //   domainName: 'hosteed.com',
      //   keySelector: 'ovh',
      //   privateKey: process.env.DKIM_PRIVATE_KEY || '',
      // },
    } as nodemailer.TransportOptions)

    const mailOptions: Mail.Options = {
      from: `"Hosteed" <${process.env.EMAIL_LOGIN}>`,
      replyTo: process.env.EMAIL_LOGIN,
      to: email,
      subject: subject,
      headers: {
        'X-Mailer': 'Hosteed Platform',
        'X-Priority': '3',
      },
      html: htmlContent,
    }

    const sendMailPromise = () =>
      new Promise<string>((resolve, reject) => {
        transport.sendMail(mailOptions, function (err) {
          if (!err) {
            resolve('Email sent')
          } else {
            reject(err.message)
          }
        })
      })

    await sendMailPromise()
    console.log(`EMAIL TEMPLATE ${templateName} ENVOYÉ AVEC SUCCÈS À ${email}`)
    return { success: true, message: 'Email sent' }
  } catch (err) {
    console.error(`ERREUR D'ENVOI D'EMAIL TEMPLATE ${templateName}:`, err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erreur inconnue',
    }
  }
}

export async function sendRoleUpdateNotification(
  userEmail: string,
  userName: string,
  newRole: string
) {
  try {
    // Déterminer les informations du rôle
    const roleInfo = getRoleInfo(newRole)

    const variables = {
      userName: userName || 'Utilisateur',
      newRoleClass: roleInfo.class,
      newRoleEmoji: roleInfo.emoji,
      newRoleLabel: roleInfo.label,
      roleDescription: roleInfo.description,
      loginUrl: `${process.env.NEXTAUTH_URL || 'https://hosteed.fr'}/auth`,
    }

    const result = await sendEmailFromTemplate(
      'role-updated',
      userEmail,
      `🔄 Mise à jour de votre rôle sur Hosteed`,
      variables
    )

    return result
  } catch (error) {
    console.error("Erreur lors de l'envoi de la notification de rôle:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    }
  }
}

function getRoleInfo(role: string) {
  switch (role) {
    case 'ADMIN':
      return {
        class: 'admin',
        emoji: '👑',
        label: 'Administrateur',
        description:
          "Vous avez maintenant accès à toutes les fonctionnalités d'administration de la plateforme, y compris la gestion des utilisateurs, la modération du contenu et les paramètres système.",
      }
    case 'HOST':
      return {
        class: 'host',
        emoji: '🏠',
        label: 'Hôte',
        description:
          'Vous pouvez maintenant publier et gérer vos propres annonces de logement, recevoir des réservations et communiquer avec les voyageurs.',
      }
    case 'GUEST':
    default:
      return {
        class: 'guest',
        emoji: '👤',
        label: 'Invité',
        description:
          'Vous pouvez rechercher et réserver des logements, laisser des avis et communiquer avec les hôtes.',
      }
  }
}
