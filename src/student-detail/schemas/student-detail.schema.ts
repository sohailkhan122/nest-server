import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StudentDetailDocument = HydratedDocument<StudentDetail>;

@Schema({ _id: false })
export class StudentProject {
  @Prop({ type: String, required: false })
  title: string;

  @Prop({ type: String, required: false })
  description: string;

  @Prop({ type: [String], default: [] })
  technologies?: string[];

  @Prop({ type: String, default: null })
  projectUrl?: string | null;
}

export const StudentProjectSchema = SchemaFactory.createForClass(StudentProject);

@Schema({ timestamps: true })
export class StudentDetail {

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true }) 
  phone: string;

  @Prop({ type: String, required: true })
  dateOfBirth: string;

  @Prop({ type: String, required: true })
  gender: string;

  @Prop({ type: String, required: true })
  bio: string;

  @Prop({ type: String, default: null })
  experience?: string | null;

  @Prop({ type: String, default: null })
  requiredJob?: string | null;

  @Prop({ type: String, default: null })
  requiredExperience?: string | null;

  @Prop({ type: [String], default: [] })
  skills: string[];

  @Prop({ type: [StudentProjectSchema], default: [] })
  projects?: StudentProject[];

  @Prop({ type: String, required: true })
  degree: string;

  @Prop({ type: String, required: true })
  fieldOfStudy: string;

  @Prop({ type: String, required: true })
  graduationYear: string;

  @Prop({ type: String, required: true })
  institution: string;

  @Prop({ type: String, default: null })
  linkedIn?: string | null;
}

export const StudentDetailSchema = SchemaFactory.createForClass(StudentDetail);